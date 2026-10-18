/*
 * Hand-written libssh2 build configuration for Apple platforms (iOS/tvOS).
 *
 * libssh2 normally generates this from CMake/autotools. We compile the vendored
 * sources with HAVE_CONFIG_H so libssh2_setup.h picks this up. Keep it in sync
 * with the `#cmakedefine` list in vendor/libssh2/src/libssh2_config_cmake.h.in.
 */
#ifndef LIBSSH2_CONFIG_H
#define LIBSSH2_CONFIG_H

/* Headers */
#define HAVE_UNISTD_H 1
#define HAVE_INTTYPES_H 1
#define HAVE_SYS_SELECT_H 1
#define HAVE_SYS_UIO_H 1
#define HAVE_SYS_SOCKET_H 1
#define HAVE_SYS_IOCTL_H 1
#define HAVE_SYS_TIME_H 1
#define HAVE_SYS_UN_H 1

/* BSD sockets */
#define HAVE_ARPA_INET_H 1
#define HAVE_NETINET_IN_H 1

/* Functions */
#define HAVE_GETTIMEOFDAY 1
#define HAVE_STRTOLL 1
#define HAVE_SNPRINTF 1

/* I/O multiplexing + non-blocking sockets */
#define HAVE_POLL 1
#define HAVE_SELECT 1
#define HAVE_O_NONBLOCK 1
#define HAVE_SO_NONBLOCK 1

#endif /* LIBSSH2_CONFIG_H */
