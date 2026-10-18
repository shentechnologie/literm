/*
 * mbedTLS entropy source for Apple platforms.
 *
 * mbedTLS's default entropy poll reads /dev/urandom. On iOS the platform
 * RNG (SecRandomCopyBytes) is the supported source, so we define
 * MBEDTLS_ENTROPY_HARDWARE_ALT and provide this hook. It is pulled in by
 * library/entropy_poll.c whenever that macro is set.
 */
#if defined(MBEDTLS_ENTROPY_HARDWARE_ALT)

#include "mbedtls/build_info.h"
#include "mbedtls/entropy.h"

#include <Security/Security.h>
#include <string.h>

int mbedtls_hardware_poll(void *data, unsigned char *output, size_t len, size_t *olen)
{
    (void)data;
    if (SecRandomCopyBytes(kSecRandomDefault, len, output) != errSecSuccess) {
        *olen = 0;
        return MBEDTLS_ERR_ENTROPY_SOURCE_FAILED;
    }
    *olen = len;
    return 0;
}

#endif /* MBEDTLS_ENTROPY_HARDWARE_ALT */
