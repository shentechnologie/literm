/*
 * Engine smoke test: drives `SecureShellSession` (the exact code the iOS module
 * uses) against a live SSH server and exercises the full path — staged host-key
 * gate, auth, pty shell, write, read, resize, close.
 *
 * The engine is plain Foundation + POSIX, so it builds for the macOS host as
 * well as for iOS. That makes it runnable in CI against tools/ssh-test-server
 * without a simulator:
 *
 *   packages/react-native-terminal/scripts/engine-smoke.sh
 *
 * Exits 0 when the remote echoes the command we sent.
 */
#import <Foundation/Foundation.h>
#import <dispatch/dispatch.h>

#import "SecureShellNative.h"

static NSString *const kCommand = @"echo hello-from-engine";

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSString *host = argc > 1 ? @(argv[1]) : @"127.0.0.1";
    NSInteger port = argc > 2 ? atoi(argv[2]) : 2222;
    NSString *user = argc > 3 ? @(argv[3]) : @"test";
    NSString *pass = argc > 4 ? @(argv[4]) : @"shenterm";

    SecureShellSession *session = [[SecureShellSession alloc] initWithHost:host
                                                                     port:port
                                                                 username:user
                                                                     auth:SecureShellAuthMethodPassword
                                                                 password:pass
                                                               privateKey:nil
                                                               passphrase:nil
                                                                timeoutMs:10000];

    NSMutableData *received = [NSMutableData data];
    NSLock *receivedLock = [NSLock new];
    __block BOOL done = NO;

    session.onHostKey = ^(NSString *algorithm, NSString *sha256, NSString *knownHostsLine) {
      fprintf(stderr, "[hostkey] %s %s\n", algorithm.UTF8String, sha256.UTF8String);
      [session respondHostKey:YES];
    };
    session.onConnected = ^{
      fprintf(stderr, "[connected]\n");
      [session openShellCols:80 rows:24];
    };
    session.onDataAvailable = ^{
      NSData *chunk;
      while ((chunk = [session read:65536]) != nil) {
        [receivedLock lock];
        [received appendData:chunk];
        [receivedLock unlock];
      }
    };
    session.onError = ^(NSString *message) {
      fprintf(stderr, "[error] %s\n", message.UTF8String);
    };
    session.onClose = ^(NSString *reason) {
      fprintf(stderr, "[close] %s\n", reason.UTF8String);
      done = YES;
    };

    [session start];

    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.5 * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
      [session write:[[kCommand stringByAppendingString:@"\r"] dataUsingEncoding:NSUTF8StringEncoding]];
    });
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(3.0 * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
      [session resizeCols:120 rows:40];
      [session write:[@"exit\r" dataUsingEncoding:NSUTF8StringEncoding]];
    });

    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:10];
    while (!done && [deadline timeIntervalSinceNow] > 0) {
      [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode
                               beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
    }
    [session disconnect];

    [receivedLock lock];
    NSString *text = [[NSString alloc] initWithData:received encoding:NSUTF8StringEncoding];
    [receivedLock unlock];

    fprintf(stdout, "---- received ----\n%s\n------------------\n", text.UTF8String);
    BOOL ok = [text containsString:@"hello-from-engine"];
    fprintf(stdout, "RESULT: %s\n", ok ? "PASS" : "FAIL");
    return ok ? 0 : 1;
  }
}
