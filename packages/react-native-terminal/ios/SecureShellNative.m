#import "SecureShellNative.h"

#import <CommonCrypto/CommonDigest.h>

#include "libssh2.h"

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netdb.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

/// Cap on buffered remote output. Past this the I/O thread stops reading the
/// channel, which lets SSH window flow control push back on the server instead
/// of growing memory without bound.
static const NSUInteger kMaxInboundBytes = 2 * 1024 * 1024;
static const int kReadChunk = 16 * 1024;
static const NSInteger kHostKeyGateTimeoutMs = 30000;
static const int kPollSliceMs = 200;

typedef NS_ENUM(NSInteger, SecureShellGateResult) {
  SecureShellGateAccepted,
  SecureShellGateRejected,
  SecureShellGateFailed,
};

#pragma mark - Key formatting helpers

/// The SSH key type is the first string of the public-key blob, and is exactly
/// what `known_hosts` and the JS fingerprint contract expect (e.g. `ssh-ed25519`).
static NSString *SecureShellKeyAlgorithm(NSData *blob) {
  const uint8_t *bytes = blob.bytes;
  NSUInteger length = blob.length;
  if (length < 4) return @"unknown";
  uint32_t n = ((uint32_t)bytes[0] << 24) | ((uint32_t)bytes[1] << 16) |
               ((uint32_t)bytes[2] << 8) | (uint32_t)bytes[3];
  if (n == 0 || 4 + (NSUInteger)n > length) return @"unknown";
  NSString *name = [[NSString alloc] initWithBytes:(bytes + 4)
                                            length:n
                                          encoding:NSASCIIStringEncoding];
  return name ?: @"unknown";
}

/// OpenSSH-style fingerprint: base64(SHA-256(blob)) without padding.
static NSString *SecureShellSHA256Base64(NSData *blob) {
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(blob.bytes, (CC_LONG)blob.length, digest);
  NSData *hash = [NSData dataWithBytes:digest length:CC_SHA256_DIGEST_LENGTH];
  NSString *encoded = [hash base64EncodedStringWithOptions:0];
  return [encoded stringByTrimmingCharactersInSet:
              [NSCharacterSet characterSetWithCharactersInString:@"="]];
}

static NSString *SecureShellKnownHostsLine(NSString *host, NSInteger port,
                                           NSString *algorithm, NSData *blob) {
  NSString *target = (port == 22) ? host
                                  : [NSString stringWithFormat:@"[%@]:%ld", host, (long)port];
  return [NSString stringWithFormat:@"%@ %@ %@", target, algorithm,
                                    [blob base64EncodedStringWithOptions:0]];
}

NSString *SecureShellLibssh2Version(void) {
  return @(libssh2_version(0));
}

#pragma mark - Session

@implementation SecureShellSession {
  NSString *_host;
  NSInteger _port;
  NSString *_username;
  SecureShellAuthMethod _auth;
  NSString *_password;
  NSString *_privateKey;
  NSString *_passphrase;
  NSInteger _timeoutMs;

  NSThread *_thread;
  int _sock;
  int _wake[2];

  LIBSSH2_SESSION *_session;
  LIBSSH2_CHANNEL *_channel;
  BOOL _eofSeen;
  BOOL _errorSeen;

  // Control state, guarded by _stateLock.
  NSLock *_stateLock;
  NSMutableData *_outbound;
  NSUInteger _outboundSent;
  SecureShellHostKeyDecision _hostKeyDecision;
  BOOL _shellRequested;
  NSInteger _shellCols;
  NSInteger _shellRows;
  BOOL _resizePending;
  NSInteger _resizeCols;
  NSInteger _resizeRows;
  BOOL _closing;
  BOOL _closeEmitted;

  // Inbound ring, guarded by _inboundLock.
  NSLock *_inboundLock;
  NSMutableData *_inbound;
  NSUInteger _inboundOffset;
}

- (instancetype)initWithHost:(NSString *)host
                        port:(NSInteger)port
                    username:(NSString *)username
                        auth:(SecureShellAuthMethod)auth
                    password:(nullable NSString *)password
                  privateKey:(nullable NSString *)privateKey
                  passphrase:(nullable NSString *)passphrase
                   timeoutMs:(NSInteger)timeoutMs {
  if ((self = [super init])) {
    _host = [host copy];
    _port = port;
    _username = [username copy];
    _auth = auth;
    _password = [password copy];
    _privateKey = [privateKey copy];
    _passphrase = [passphrase copy];
    _timeoutMs = timeoutMs > 0 ? timeoutMs : 15000;

    _sock = -1;
    _wake[0] = -1;
    _wake[1] = -1;

    _stateLock = [NSLock new];
    _inboundLock = [NSLock new];
    _outbound = [NSMutableData data];
    _inbound = [NSMutableData data];
    _hostKeyDecision = SecureShellHostKeyDecisionPending;
  }
  return self;
}

- (void)dealloc {
  if (_wake[0] >= 0) close(_wake[0]);
  if (_wake[1] >= 0) close(_wake[1]);
  if (_sock >= 0) close(_sock);
}

#pragma mark - Public API (called from the JS thread)

- (void)start {
  if (pipe(_wake) != 0) {
    _wake[0] = -1;
    _wake[1] = -1;
  } else {
    fcntl(_wake[0], F_SETFL, fcntl(_wake[0], F_GETFL, 0) | O_NONBLOCK);
    fcntl(_wake[1], F_SETFL, fcntl(_wake[1], F_GETFL, 0) | O_NONBLOCK);
  }
  _thread = [[NSThread alloc] initWithTarget:self selector:@selector(ioMain) object:nil];
  _thread.name = @"SecureShell.io";
  _thread.qualityOfService = NSQualityOfServiceUserInitiated;
  [_thread start];
}

- (void)respondHostKey:(BOOL)accept {
  [_stateLock lock];
  if (_hostKeyDecision == SecureShellHostKeyDecisionPending) {
    _hostKeyDecision = accept ? SecureShellHostKeyDecisionAccept
                              : SecureShellHostKeyDecisionReject;
  }
  [_stateLock unlock];
  [self wake];
}

- (void)openShellCols:(NSInteger)cols rows:(NSInteger)rows {
  [_stateLock lock];
  _shellCols = cols;
  _shellRows = rows;
  _shellRequested = YES;
  [_stateLock unlock];
  [self wake];
}

- (void)write:(NSData *)data {
  if (data.length == 0) return;
  [_stateLock lock];
  if (!_closing) [_outbound appendData:data];
  [_stateLock unlock];
  [self wake];
}

- (nullable NSData *)read:(NSInteger)maxBytes {
  if (maxBytes <= 0) return nil;
  NSData *chunk = nil;
  BOOL drained = NO;
  [_inboundLock lock];
  NSUInteger available = _inbound.length - _inboundOffset;
  if (available > 0) {
    NSUInteger n = MIN((NSUInteger)maxBytes, available);
    chunk = [_inbound subdataWithRange:NSMakeRange(_inboundOffset, n)];
    _inboundOffset += n;
    if (_inboundOffset >= _inbound.length) {
      [_inbound setLength:0];
      _inboundOffset = 0;
    } else if (_inboundOffset > 128 * 1024) {
      [_inbound replaceBytesInRange:NSMakeRange(0, _inboundOffset)
                          withBytes:NULL
                             length:0];
      _inboundOffset = 0;
    }
    drained = (_inbound.length - _inboundOffset) < kMaxInboundBytes;
  }
  [_inboundLock unlock];
  // Wake the I/O thread if it parked on a full inbound buffer.
  if (drained) [self wake];
  return chunk;
}

- (void)resizeCols:(NSInteger)cols rows:(NSInteger)rows {
  [_stateLock lock];
  _resizePending = YES;
  _resizeCols = cols;
  _resizeRows = rows;
  [_stateLock unlock];
  [self wake];
}

- (void)disconnect {
  [_stateLock lock];
  _closing = YES;
  [_stateLock unlock];
  [self wake];
}

#pragma mark - I/O thread

- (void)ioMain {
  NSString *closeReason = @"closed";

  if ([self connectSocket] && [self beginSession]) {
    SecureShellGateResult gate = [self gateHostKey];
    if (gate == SecureShellGateAccepted && [self authenticate]) {
      [self emitConnected];
      if ([self awaitShellRequest] && [self openShell]) {
        [self streamLoop];
        if (_eofSeen) {
          closeReason = @"eof";
        } else if (_errorSeen) {
          [self emitError:[self lastErrorMessage]];
          closeReason = @"error";
        }
      } else if (![self isClosing]) {
        [self emitError:[self lastErrorMessage]];
        closeReason = @"error";
      }
    } else if (gate == SecureShellGateFailed) {
      [self emitError:[self lastErrorMessage]];
      closeReason = @"error";
    }
    // Gate rejected: the JS verifier already reported the rejection.
  } else if (![self isClosing]) {
    [self emitError:[self lastErrorMessage]];
    closeReason = @"error";
  }

  [self teardown];
  [self emitClose:closeReason];
}

#pragma mark - Connect / handshake

- (BOOL)connectSocket {
  struct addrinfo hints;
  memset(&hints, 0, sizeof(hints));
  hints.ai_family = AF_UNSPEC;
  hints.ai_socktype = SOCK_STREAM;

  char port[16];
  snprintf(port, sizeof(port), "%ld", (long)_port);

  struct addrinfo *result = NULL;
  if (getaddrinfo(_host.UTF8String, port, &hints, &result) != 0) return NO;

  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:_timeoutMs / 1000.0];
  for (struct addrinfo *ai = result; ai != NULL; ai = ai->ai_next) {
    if ([self isClosing]) break;
    int fd = socket(ai->ai_family, ai->ai_socktype, ai->ai_protocol);
    if (fd < 0) continue;

    int flags = fcntl(fd, F_GETFL, 0);
    fcntl(fd, F_SETFL, flags | O_NONBLOCK);
    int one = 1;
    setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one));

    if (connect(fd, ai->ai_addr, ai->ai_addrlen) == 0) {
      _sock = fd;
      break;
    }
    if (errno != EINPROGRESS) {
      close(fd);
      continue;
    }

    NSInteger remaining = (NSInteger)([deadline timeIntervalSinceNow] * 1000.0);
    struct pollfd pfd = { .fd = fd, .events = POLLOUT };
    int pr = poll(&pfd, 1, remaining > 0 ? (int)remaining : 0);
    if (pr > 0) {
      int err = 0;
      socklen_t len = sizeof(err);
      getsockopt(fd, SOL_SOCKET, SO_ERROR, &err, &len);
      if (err == 0) {
        _sock = fd;
        break;
      }
    }
    close(fd);
  }
  freeaddrinfo(result);
  return _sock >= 0;
}

- (BOOL)beginSession {
  _session = libssh2_session_init();
  if (!_session) return NO;
  libssh2_session_set_blocking(_session, 0);
  libssh2_session_set_timeout(_session, (long)_timeoutMs);

  int rc = [self runSessionAction:^int {
    return libssh2_session_handshake(_session, (libssh2_socket_t)_sock);
  }];
  return rc == 0;
}

- (SecureShellGateResult)gateHostKey {
  size_t length = 0;
  int type = 0;
  const char *key = libssh2_session_hostkey(_session, &length, &type);
  if (key == NULL || length == 0) return SecureShellGateFailed;

  NSData *blob = [NSData dataWithBytes:key length:length];
  NSString *algorithm = SecureShellKeyAlgorithm(blob);
  NSString *sha256 = SecureShellSHA256Base64(blob);
  NSString *line = SecureShellKnownHostsLine(_host, _port, algorithm, blob);

  if (self.onHostKey) self.onHostKey(algorithm, sha256, line);

  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:kHostKeyGateTimeoutMs / 1000.0];
  for (;;) {
    [_stateLock lock];
    SecureShellHostKeyDecision decision = _hostKeyDecision;
    BOOL closing = _closing;
    [_stateLock unlock];

    if (decision != SecureShellHostKeyDecisionPending) {
      return decision == SecureShellHostKeyDecisionAccept
                 ? SecureShellGateAccepted
                 : SecureShellGateRejected;
    }
    if (closing) return SecureShellGateFailed;
    if ([deadline timeIntervalSinceNow] <= 0) return SecureShellGateRejected;
    [self waitForWake:200];
  }
}

- (BOOL)authenticate {
  const char *user = _username.UTF8String;
  if (_auth == SecureShellAuthMethodPrivateKey) {
    NSData *privateKey = [_privateKey dataUsingEncoding:NSUTF8StringEncoding];
    const char *passphrase = _passphrase.length ? _passphrase.UTF8String : NULL;
    int rc = [self runSessionAction:^int {
      return libssh2_userauth_publickey_frommemory(
          _session, user, strlen(user), NULL, 0,
          privateKey.bytes, privateKey.length, passphrase);
    }];
    return rc == 0;
  }

  const char *password = (_password ?: @"").UTF8String;
  int rc = [self runSessionAction:^int {
    return libssh2_userauth_password_ex(_session, user, (unsigned int)strlen(user),
                                        password, (unsigned int)strlen(password), NULL);
  }];
  return rc == 0;
}

- (BOOL)awaitShellRequest {
  for (;;) {
    [_stateLock lock];
    BOOL requested = _shellRequested;
    BOOL closing = _closing;
    [_stateLock unlock];
    if (requested) return YES;
    if (closing) return NO;
    [self waitForWake:200];
  }
}

- (BOOL)openShell {
  LIBSSH2_CHANNEL *channel = NULL;
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:_timeoutMs / 1000.0];
  for (;;) {
    channel = libssh2_channel_open_session(_session);
    if (channel) break;
    if (libssh2_session_last_errno(_session) != LIBSSH2_ERROR_EAGAIN) return NO;
    if ([self isClosing] || [deadline timeIntervalSinceNow] <= 0) return NO;
    [self pollForDirections:libssh2_session_block_directions(_session) timeoutMs:kPollSliceMs];
  }
  _channel = channel;

  const char *term = "xterm-256color";
  int rc = [self runSessionAction:^int {
    return libssh2_channel_request_pty_ex(_channel, term, (unsigned int)strlen(term),
                                          NULL, 0, (int)_shellCols, (int)_shellRows, 0, 0);
  }];
  if (rc != 0) return NO;

  // Merge stderr into the shell stream, matching the JSch backend on Android.
  [self runSessionAction:^int {
    return libssh2_channel_handle_extended_data2(_channel, LIBSSH2_CHANNEL_EXTENDED_DATA_MERGE);
  }];

  rc = [self runSessionAction:^int {
    return libssh2_channel_shell(_channel);
  }];
  return rc == 0;
}

#pragma mark - Streaming

- (void)streamLoop {
  char *buffer = malloc(kReadChunk);
  if (buffer == NULL) {
    _errorSeen = YES;
    return;
  }

  while (![self isClosing]) {
    @autoreleasepool {
      [self applyResizeIfNeeded];
      [self flushOutbound];
      if ([self isClosing]) break;

      if ([self pumpReads:buffer]) [self emitDataAvailable];
      if (_eofSeen || _errorSeen) break;

      if ([self inboundCount] >= kMaxInboundBytes) {
        // Backpressure: wait for the JS drain loop to free space (read: wakes us).
        [self waitForWake:kPollSliceMs];
      } else {
        [self pollForDirections:LIBSSH2_SESSION_BLOCK_INBOUND timeoutMs:kPollSliceMs];
      }
    }
  }
  free(buffer);
}

- (BOOL)pumpReads:(char *)buffer {
  BOOL appended = NO;
  for (;;) {
    if ([self isClosing] || _eofSeen || _errorSeen) break;
    if ([self inboundCount] >= kMaxInboundBytes) break;

    ssize_t n = libssh2_channel_read_ex(_channel, 0, buffer, kReadChunk);
    if (n > 0) {
      [self appendInbound:buffer length:(NSUInteger)n];
      appended = YES;
      continue;
    }
    if (n == 0) {
      _eofSeen = YES;
      break;
    }
    if (n == LIBSSH2_ERROR_EAGAIN) break;
    _errorSeen = YES;
    break;
  }
  return appended;
}

- (void)flushOutbound {
  while (![self isClosing]) {
    [_stateLock lock];
    NSUInteger length = _outbound.length;
    NSUInteger sent = _outboundSent;
    if (sent >= length) {
      [_outbound setLength:0];
      _outboundSent = 0;
      [_stateLock unlock];
      return;
    }
    NSData *pending = [_outbound subdataWithRange:NSMakeRange(sent, length - sent)];
    [_stateLock unlock];

    NSUInteger written = 0;
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:_timeoutMs / 1000.0];
    for (;;) {
      if ([self isClosing]) return;
      ssize_t rc = libssh2_channel_write_ex(_channel, 0,
                                            (const char *)pending.bytes + written,
                                            pending.length - written);
      if (rc > 0) {
        written += (NSUInteger)rc;
        if (written >= pending.length) break;
        continue;
      }
      if (rc == LIBSSH2_ERROR_EAGAIN) {
        if ([deadline timeIntervalSinceNow] <= 0) {
          _errorSeen = YES;
          return;
        }
        [self pollForDirections:libssh2_session_block_directions(_session)
                      timeoutMs:kPollSliceMs];
        continue;
      }
      _errorSeen = YES;
      return;
    }

    [_stateLock lock];
    _outboundSent += written;
    if (_outboundSent >= _outbound.length) {
      [_outbound setLength:0];
      _outboundSent = 0;
    }
    [_stateLock unlock];
  }
}

- (void)applyResizeIfNeeded {
  [_stateLock lock];
  BOOL pending = _resizePending;
  NSInteger cols = _resizeCols;
  NSInteger rows = _resizeRows;
  _resizePending = NO;
  [_stateLock unlock];
  if (!pending || _channel == NULL) return;

  [self runSessionAction:^int {
    return libssh2_channel_request_pty_size_ex(_channel, (int)cols, (int)rows, 0, 0);
  }];
}

#pragma mark - libssh2 non-blocking driver

/// Runs `action`, polling the socket on EAGAIN until it completes or the
/// per-operation deadline elapses. Returns the last libssh2 return code.
- (int)runSessionAction:(int (^)(void))action {
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:_timeoutMs / 1000.0];
  for (;;) {
    if ([self isClosing]) return LIBSSH2_ERROR_SOCKET_DISCONNECT;
    int rc = action();
    if (rc != LIBSSH2_ERROR_EAGAIN) return rc;

    NSTimeInterval remaining = [deadline timeIntervalSinceNow];
    if (remaining <= 0) return -1;
    int slice = (int)MIN((NSTimeInterval)kPollSliceMs, remaining * 1000.0);
    [self pollForDirections:libssh2_session_block_directions(_session) timeoutMs:slice];
  }
}

- (void)pollForDirections:(int)directions timeoutMs:(int)timeoutMs {
  if (_sock < 0) return;
  struct pollfd fds[2];
  fds[0].fd = _sock;
  fds[0].events = 0;
  fds[0].revents = 0;
  if (directions & LIBSSH2_SESSION_BLOCK_INBOUND) fds[0].events |= POLLIN;
  if (directions & LIBSSH2_SESSION_BLOCK_OUTBOUND) fds[0].events |= POLLOUT;
  fds[1].fd = _wake[0];
  fds[1].events = POLLIN;
  fds[1].revents = 0;

  int ready = poll(fds, 2, timeoutMs > 0 ? timeoutMs : kPollSliceMs);
  if (ready > 0 && (fds[1].revents & POLLIN)) [self drainWake];
}

/// Parks until the wake pipe fires or the timeout elapses. Used in phases where
/// there is no socket work to do (host-key gate, waiting for openShell).
- (void)waitForWake:(int)timeoutMs {
  if (_wake[0] < 0) return;
  struct pollfd pfd = { .fd = _wake[0], .events = POLLIN };
  poll(&pfd, 1, timeoutMs > 0 ? timeoutMs : kPollSliceMs);
  [self drainWake];
}

- (void)wake {
  if (_wake[1] < 0) return;
  uint8_t byte = 1;
  ssize_t ignored = write(_wake[1], &byte, 1);
  (void)ignored;
}

- (void)drainWake {
  if (_wake[0] < 0) return;
  uint8_t buffer[64];
  while (read(_wake[0], buffer, sizeof(buffer)) > 0) {
  }
}

#pragma mark - Teardown / events

- (void)teardown {
  if (_channel) {
    libssh2_channel_close(_channel);
    libssh2_channel_free(_channel);
    _channel = NULL;
  }
  if (_session) {
    libssh2_session_disconnect_ex(_session, SSH_DISCONNECT_BY_APPLICATION, "bye", "en");
    libssh2_session_free(_session);
    _session = NULL;
  }
  if (_sock >= 0) {
    close(_sock);
    _sock = -1;
  }
}

- (BOOL)isClosing {
  [_stateLock lock];
  BOOL value = _closing;
  [_stateLock unlock];
  return value;
}

- (NSUInteger)inboundCount {
  [_inboundLock lock];
  NSUInteger count = _inbound.length - _inboundOffset;
  [_inboundLock unlock];
  return count;
}

- (void)appendInbound:(const char *)bytes length:(NSUInteger)length {
  [_inboundLock lock];
  [_inbound appendBytes:bytes length:length];
  [_inboundLock unlock];
}

- (NSString *)lastErrorMessage {
  if (!_session) return @"ssh session unavailable";
  char *message = NULL;
  int length = 0;
  int rc = libssh2_session_last_error(_session, &message, &length, 0);
  if (message && length > 0) {
    NSString *text = [[NSString alloc] initWithBytes:message
                                              length:(NSUInteger)length
                                            encoding:NSUTF8StringEncoding];
    if (text) return text;
  }
  return [NSString stringWithFormat:@"libssh2 error %d", rc];
}

- (void)emitConnected {
  if (self.onConnected) self.onConnected();
}

- (void)emitDataAvailable {
  if (self.onDataAvailable) self.onDataAvailable();
}

- (void)emitError:(NSString *)message {
  if (self.onError) self.onError(message ?: @"ssh error");
}

- (void)emitClose:(NSString *)reason {
  [_stateLock lock];
  if (_closeEmitted) {
    [_stateLock unlock];
    return;
  }
  _closeEmitted = YES;
  [_stateLock unlock];
  if (self.onClose) self.onClose(reason);
}

@end
