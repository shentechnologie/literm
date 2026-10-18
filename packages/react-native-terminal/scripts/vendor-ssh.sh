#!/usr/bin/env bash
#
# Refresh the vendored SSH/crypto sources.
#
#   packages/react-native-terminal/ios/vendor/
#     libssh2/   libssh2-<ver>  (BSD-3-Clause)
#     mbedtls/   mbedtls-<ver>  (Apache-2.0)
#
# The sources are committed so `pod install` / EAS builds need no network and
# no Rust/C toolchain beyond Xcode's clang. Re-run this only to bump a version.
#
# Usage: scripts/vendor-ssh.sh
set -euo pipefail

LIBSSH2_VERSION="${LIBSSH2_VERSION:-1.11.1}"
MBEDTLS_VERSION="${MBEDTLS_VERSION:-3.6.4}"

LIBSSH2_TAG="libssh2-${LIBSSH2_VERSION}"
MBEDTLS_TAG="v${MBEDTLS_VERSION}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_ROOT="$(cd "${HERE}/.." && pwd)"
VENDOR="${PKG_ROOT}/ios/vendor"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

echo "==> cloning libssh2 ${LIBSSH2_TAG}"
git clone --depth 1 --branch "${LIBSSH2_TAG}" \
  https://github.com/libssh2/libssh2 "${WORK}/libssh2"

echo "==> cloning mbedtls ${MBEDTLS_TAG}"
git clone --depth 1 --branch "${MBEDTLS_TAG}" \
  https://github.com/Mbed-TLS/mbedtls "${WORK}/mbedtls"

rm -rf "${VENDOR}/libssh2" "${VENDOR}/mbedtls"
mkdir -p "${VENDOR}/libssh2" "${VENDOR}/mbedtls"

# libssh2: public headers + implementation. The pod compiles src/*.c.
cp -R "${WORK}/libssh2/include" "${VENDOR}/libssh2/include"
cp -R "${WORK}/libssh2/src" "${VENDOR}/libssh2/src"
cp "${WORK}/libssh2/COPYING" "${VENDOR}/libssh2/COPYING"
# Keep provenance for reviewers. The committing change records the tag.
git -C "${WORK}/libssh2" rev-parse HEAD > "${VENDOR}/libssh2/COMMIT"
printf '%s\n' "${LIBSSH2_TAG}" > "${VENDOR}/libssh2/VERSION"

# mbedtls: headers + library implementation (includes psa_*.c — mandatory in
# 3.x). The pod compiles library/*.c.
cp -R "${WORK}/mbedtls/include" "${VENDOR}/mbedtls/include"
cp -R "${WORK}/mbedtls/library" "${VENDOR}/mbedtls/library"
cp "${WORK}/mbedtls/LICENSE" "${VENDOR}/mbedtls/LICENSE"
git -C "${WORK}/mbedtls" rev-parse HEAD > "${VENDOR}/mbedtls/COMMIT"
printf '%s\n' "${MBEDTLS_TAG}" > "${VENDOR}/mbedtls/VERSION"

# Drop artifacts that must not be compiled/linked.
find "${VENDOR}/libssh2" -name '*.orig' -delete
find "${VENDOR}/mbedtls/library" -name '*.o' -delete 2>/dev/null || true

echo "==> done:"
echo "    libssh2 ${LIBSSH2_VERSION}  -> ${VENDOR}/libssh2"
echo "    mbedtls ${MBEDTLS_VERSION}  -> ${VENDOR}/mbedtls"
du -sh "${VENDOR}/libssh2" "${VENDOR}/mbedtls"
