#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Result of the staged host-key gate. The session emits the key before any
/// authentication and blocks until this is answered, so a decline (or a
/// timeout) aborts the connection with nothing authenticated.
typedef NS_ENUM(NSInteger, SecureShellHostKeyDecision) {
  SecureShellHostKeyDecisionPending = -1,
  SecureShellHostKeyDecisionReject = 0,
  SecureShellHostKeyDecisionAccept = 1,
};

typedef NS_ENUM(NSInteger, SecureShellAuthMethod) {
  SecureShellAuthMethodPassword = 0,
  SecureShellAuthMethodPrivateKey = 1,
};

/// Reports a host key during the handshake, before authentication.
typedef void (^SecureShellHostKeyBlock)(NSString *algorithm, NSString *sha256, NSString *knownHostsLine);

/// Generic session callbacks.
typedef void (^SecureShellVoidBlock)(void);
typedef void (^SecureShellStringBlock)(NSString *value);
typedef void (^SecureShellErrorBlock)(NSString *message);

/// One SSH connection driven by libssh2 on a dedicated I/O thread.
///
/// libssh2 is single-threaded per session: every libssh2 call happens on the
/// I/O thread. The JS thread only enqueues work (writes, pty size, host-key
/// decision) and pulls received bytes out of a lock-protected ring buffer.
@interface SecureShellSession : NSObject

@property (nonatomic, copy, nullable) SecureShellHostKeyBlock onHostKey;
@property (nonatomic, copy, nullable) SecureShellVoidBlock onConnected;
@property (nonatomic, copy, nullable) SecureShellErrorBlock onError;
@property (nonatomic, copy, nullable) SecureShellStringBlock onClose;
@property (nonatomic, copy, nullable) SecureShellVoidBlock onDataAvailable;

- (instancetype)initWithHost:(NSString *)host
                        port:(NSInteger)port
                    username:(NSString *)username
                       auth:(SecureShellAuthMethod)auth
                    password:(nullable NSString *)password
                  privateKey:(nullable NSString *)privateKey
                  passphrase:(nullable NSString *)passphrase
                   timeoutMs:(NSInteger)timeoutMs;

/// Start the background handshake. Returns immediately.
- (void)start;

/// Answer the host-key gate. Safe to call before `onHostKey` fires.
- (void)respondHostKey:(BOOL)accept;

/// Open the shell channel (after `onConnected`).
- (void)openShellCols:(NSInteger)cols rows:(NSInteger)rows;

/// Enqueue bytes for the remote pty. Never blocks.
- (void)write:(NSData *)data;

/// Pull up to `maxBytes`; nil when drained.
- (nullable NSData *)read:(NSInteger)maxBytes;

/// Window-change for the open pty.
- (void)resizeCols:(NSInteger)cols rows:(NSInteger)rows;

/// Tear down socket, channel and session.
- (void)disconnect;

@end

/// libssh2 version string, for build verification.
FOUNDATION_EXPORT NSString *SecureShellLibssh2Version(void);

NS_ASSUME_NONNULL_END
