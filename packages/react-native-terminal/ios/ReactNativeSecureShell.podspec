Pod::Spec.new do |s|
  s.name           = 'ReactNativeSecureShell'
  s.version        = '0.1.0'
  s.summary        = 'Native SSH client for React Native and Expo.'
  s.description    = 'Connections with a staged host-key gate, password and private-key auth, and interactive shells. Bundles libssh2 + mbedTLS.'
  s.license        = { :type => 'MIT', :file => '../LICENSE' }
  s.author         = 'Shenterm'
  s.homepage       = 'https://github.com/shentechnologie/literm'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { :git => 'https://github.com/shentechnologie/literm.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # --- vendored C -----------------------------------------------------------------
  # libssh2 1.11.1 (BSD-3-Clause) + mbedTLS 3.6.4 (Apache-2.0). Both are compiled
  # into this pod target. Headers are resolved through HEADER_SEARCH_PATHS rather
  # than CocoaPods header maps, so the vendored trees stay byte-for-byte upstream.
  s.source_files = [
    '*.{h,m,swift}',
    'SecureShellEntropy.c',
    'vendor/mbedtls/library/*.c',
    'vendor/libssh2/src/*.c',
  ]

  s.public_header_files = 'SecureShellNative.h'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
    'HEADER_SEARCH_PATHS' => '"${PODS_TARGET_SRCROOT}/include" "${PODS_TARGET_SRCROOT}/vendor/mbedtls/include" "${PODS_TARGET_SRCROOT}/vendor/mbedtls/library" "${PODS_TARGET_SRCROOT}/vendor/libssh2/include" "${PODS_TARGET_SRCROOT}/vendor/libssh2/src"',
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) HAVE_CONFIG_H=1 LIBSSH2_MBEDTLS=1 MBEDTLS_ENTROPY_HARDWARE_ALT=1',
  }

  s.frameworks = 'Security'
end
