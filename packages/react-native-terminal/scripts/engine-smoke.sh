#!/usr/bin/env bash
#
# Build and run the engine smoke test on the macOS host against the in-repo SSH
# test server. Exercises the same SecureShellSession the iOS module uses.
#
#   scripts/engine-smoke.sh [host] [port] [user] [password]
#
# The server side:  bun run ssh-server        (from the repo root; 0.0.0.0:2222)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG="$(cd "${HERE}/.." && pwd)"
IOS="${PKG}/ios"
OUT="$(mktemp -d)"
trap 'rm -rf "${OUT}"' EXIT

FLAGS=(
  -fobjc-arc -O0 -w
  -DHAVE_CONFIG_H=1 -DLIBSSH2_MBEDTLS=1 -DMBEDTLS_ENTROPY_HARDWARE_ALT=1
  -I"${IOS}/include"
  -I"${IOS}/vendor/mbedtls/include"
  -I"${IOS}/vendor/mbedtls/library"
  -I"${IOS}/vendor/libssh2/include"
  -I"${IOS}/vendor/libssh2/src"
  -I"${IOS}"
)

clang "${FLAGS[@]}" -o "${OUT}/engine-smoke" \
  "${PKG}/tools/engine_smoke.m" \
  "${IOS}/SecureShellNative.m" \
  "${IOS}/SecureShellEntropy.c" \
  "${IOS}"/vendor/libssh2/src/*.c \
  "${IOS}"/vendor/mbedtls/library/*.c \
  -framework Foundation -framework Security

exec "${OUT}/engine-smoke" "${1:-127.0.0.1}" "${2:-2222}" "${3:-test}" "${4:-shenterm}"
