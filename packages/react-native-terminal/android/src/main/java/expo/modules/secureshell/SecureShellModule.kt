package expo.modules.secureshell

import com.jcraft.jsch.ChannelShell
import com.jcraft.jsch.HostKey
import com.jcraft.jsch.HostKeyRepository
import com.jcraft.jsch.JSch
import com.jcraft.jsch.Session
import com.jcraft.jsch.UserInfo
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * @literm/react-native-terminal — Android backend (JSch).
 *
 * Host-key verification is a hard gate: JSch's HostKeyRepository.check() blocks
 * the handshake thread until the JS side answers respondHostKey(). Nothing is
 * authenticated before that answer, so a decline (or a timeout) aborts the
 * connection. Mirrors the iOS libssh2 backend's contract exactly.
 */
private typealias Emit = (String, Map<String, Any?>) -> Unit

interface ShellBackend {
  fun write(data: ByteArray)
  fun read(maxBytes: Int): ByteArray?
  fun resize(cols: Int, rows: Int)
  fun close()
  fun disconnect()
}

/** Ring-buffered echo backend; keeps the module usable without a server. */
class EchoShell(
  val sessionId: String,
  private val emit: Emit
) : ShellBackend {
  private val lock = Any()
  private val buffer = ArrayDeque<Byte>()

  fun banner(text: String) {
    write(text.toByteArray(Charsets.UTF_8))
  }

  override fun write(data: ByteArray) {
    val out = ArrayList<Byte>(data.size)
    for (b in data) {
      when (b.toInt()) {
        13 -> {
          out.add(13); out.add(10)
        }
        127 -> {
          out.add(8); out.add(32); out.add(8)
        }
        else -> if (b.toInt() >= 32 || b.toInt() == 9) out.add(b)
      }
    }
    if (out.isEmpty()) return
    synchronized(lock) { buffer.addAll(out) }
    emit("onDataAvailable", mapOf("sessionId" to sessionId))
  }

  override fun read(maxBytes: Int): ByteArray? {
    if (maxBytes <= 0) return null
    synchronized(lock) {
      if (buffer.isEmpty()) return null
      val count = minOf(maxBytes, buffer.size)
      val out = ByteArray(count)
      for (i in 0 until count) out[i] = buffer.removeFirst()
      return out
    }
  }

  override fun resize(cols: Int, rows: Int) {}

  override fun close() {
    emit("onClose", mapOf("sessionId" to sessionId, "reason" to "closed"))
  }

  override fun disconnect() = close()
}

class SecureShellConnection(
  private val sessionId: String,
  private val host: String,
  private val port: Int,
  private val username: String,
  private val password: String,
  private val privateKey: String,
  private val passphrase: String,
  private val timeoutMs: Int,
  private val emit: Emit
) : ShellBackend {
  private val connectExecutor: ExecutorService = Executors.newSingleThreadExecutor()
  private val readerExecutor: ExecutorService = Executors.newSingleThreadExecutor()
  private val closeEmitted = AtomicBoolean(false)

  @Volatile private var session: Session? = null
  @Volatile private var channel: ChannelShell? = null
  @Volatile private var input: InputStream? = null
  @Volatile private var output: OutputStream? = null

  private val bufferLock = Any()
  private val buffer = ArrayDeque<Byte>()

  private val writeLock = Any()
  private val hostKeyLatch = CountDownLatch(1)
  private val hostKeyAccepted = AtomicBoolean(false)

  fun start() {
    connectExecutor.execute {
      try {
        connect()
      } catch (error: Throwable) {
        android.util.Log.e("SecureShell", "connect failed", error)
        emit("onError", mapOf("sessionId" to sessionId, "message" to (error.message ?: "connect failed")))
        cleanup()
      }
    }
  }

  private fun connect() {
    val jsch = JSch()
    if (privateKey.isNotEmpty()) {
      val passBytes = if (passphrase.isNotEmpty()) passphrase.toByteArray(Charsets.UTF_8) else null
      jsch.addIdentity("shenterm", privateKey.toByteArray(Charsets.UTF_8), null, passBytes)
    }
    val newSession = jsch.getSession(username, host, port)
    if (privateKey.isEmpty()) {
      newSession.setPassword(password)
    }
    // We verify the key ourselves; JSch must not consult ~/.ssh/known_hosts.
    newSession.setConfig("StrictHostKeyChecking", "no")
    newSession.hostKeyRepository = VerifyingRepository()
    newSession.timeout = timeoutMs
    newSession.connect(timeoutMs)
    session = newSession
    emit("onConnected", mapOf("sessionId" to sessionId))
  }

  /** Called from JS with the known_hosts decision. */
  fun respondHostKey(accept: Boolean) {
    hostKeyAccepted.set(accept)
    hostKeyLatch.countDown()
  }

  fun openShell(cols: Int, rows: Int) {
    connectExecutor.execute {
      try {
        val activeSession = session ?: throw IllegalStateException("not connected")
        val shell = activeSession.openChannel("shell") as ChannelShell
        shell.setPtyType("xterm-256color")
        shell.setPtySize(cols, rows, 0, 0)
        val streamIn = shell.inputStream
        val streamOut = shell.outputStream
        shell.connect(timeoutMs)
        channel = shell
        input = streamIn
        output = streamOut
        readerExecutor.execute { readerLoop(streamIn) }
      } catch (error: Throwable) {
        emit("onError", mapOf("sessionId" to sessionId, "message" to (error.message ?: "shell failed")))
      }
    }
  }

  override fun write(data: ByteArray) {
    val stream = output ?: return
    try {
      synchronized(writeLock) {
        stream.write(data)
        stream.flush()
      }
    } catch (error: Throwable) {
      emit("onError", mapOf("sessionId" to sessionId, "message" to (error.message ?: "write failed")))
    }
  }

  override fun read(maxBytes: Int): ByteArray? {
    if (maxBytes <= 0) return null
    synchronized(bufferLock) {
      if (buffer.isEmpty()) return null
      val count = minOf(maxBytes, buffer.size)
      val out = ByteArray(count)
      for (i in 0 until count) out[i] = buffer.removeFirst()
      return out
    }
  }

  override fun resize(cols: Int, rows: Int) {
    // JSch sends a window-change when the channel is already connected.
    channel?.setPtySize(cols, rows, 0, 0)
  }

  override fun close() {
    channel?.disconnect()
    channel = null
    emitClose("closed")
  }

  override fun disconnect() {
    try {
      channel?.disconnect()
    } catch (_: Throwable) {
    }
    try {
      session?.disconnect()
    } catch (_: Throwable) {
    }
    channel = null
    session = null
    cleanup()
    emitClose("closed")
  }

  private fun readerLoop(stream: InputStream) {
    val chunk = ByteArray(16 * 1024)
    try {
      while (true) {
        val read = stream.read(chunk)
        if (read < 0) break
        if (read == 0) continue
        synchronized(bufferLock) {
          for (i in 0 until read) buffer.add(chunk[i])
        }
        emit("onDataAvailable", mapOf("sessionId" to sessionId))
      }
      emitClose("eof")
    } catch (error: Throwable) {
      if (channel != null) {
        emit("onError", mapOf("sessionId" to sessionId, "message" to (error.message ?: "read failed")))
      }
      emitClose("closed")
    }
  }

  private fun emitClose(reason: String) {
    if (closeEmitted.compareAndSet(false, true)) {
      emit("onClose", mapOf("sessionId" to sessionId, "reason" to reason))
    }
  }

  private fun cleanup() {
    try {
      connectExecutor.shutdownNow()
    } catch (_: Throwable) {
    }
    try {
      readerExecutor.shutdownNow()
    } catch (_: Throwable) {
    }
  }

  private inner class VerifyingRepository : HostKeyRepository {
    override fun check(host: String, key: ByteArray): Int {
      val algorithm = algorithmOf(key)
      val fingerprint = "SHA256:" + sha256Base64(key)
      val knownHostsLine = buildKnownHostsLine(this@SecureShellConnection.host, this@SecureShellConnection.port, algorithm, key)
      hostKeyAccepted.set(false)

      emit(
        "onHostKey",
        mapOf(
          "sessionId" to sessionId,
          "host" to this@SecureShellConnection.host,
          "port" to this@SecureShellConnection.port,
          "algorithm" to algorithm,
          "sha256" to fingerprint.removePrefix("SHA256:"),
          "knownHostsLine" to knownHostsLine
        )
      )

      val answered = hostKeyLatch.await(30, TimeUnit.SECONDS)
      return if (answered && hostKeyAccepted.get()) HostKeyRepository.OK else HostKeyRepository.NOT_INCLUDED
    }

    override fun add(hostkey: HostKey?, ui: UserInfo?) {}

    override fun remove(host: String?, type: String?) {}

    override fun remove(host: String?, type: String?, key: ByteArray?) {}

    override fun getKnownHostsRepositoryID(): String = "shenterm"

    // JSch iterates this result without a null check after check() returns OK
    // (Session.checkHost line ~1019), so empty arrays are required.
    override fun getHostKey(): Array<HostKey> = emptyArray()

    override fun getHostKey(host: String?, type: String?): Array<HostKey> = emptyArray()
  }
}

private fun sha256Base64(blob: ByteArray): String =
  Base64.getEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(blob))

private fun algorithmOf(blob: ByteArray): String {
  if (blob.size < 4) return "unknown"
  val length = ((blob[0].toInt() and 0xff) shl 24) or
    ((blob[1].toInt() and 0xff) shl 16) or
    ((blob[2].toInt() and 0xff) shl 8) or
    (blob[3].toInt() and 0xff)
  if (length <= 0 || 4 + length > blob.size) return "unknown"
  return String(blob, 4, length, Charsets.US_ASCII)
}

private fun buildKnownHostsLine(host: String, port: Int, algorithm: String, blob: ByteArray): String {
  val base64 = Base64.getEncoder().encodeToString(blob)
  // OpenSSH known_hosts uses [host]:port for non-default ports.
  val target = if (port == 22) host else "[$host]:$port"
  return "$target $algorithm $base64"
}

class SecureShellModule : Module() {
  private val backends = mutableMapOf<String, ShellBackend>()
  private val counter = AtomicInteger(0)

  override fun definition() = ModuleDefinition {
    Name("SecureShell")

    Events("onDataAvailable", "onClose", "onHostKey", "onConnected", "onError")

    Function("libssh2Version") {
      // The Android backend is JSch, not libssh2.
      "jsch"
    }

    Function("openEchoShell") { cols: Int, rows: Int, banner: String ->
      val id = "echo-${counter.getAndIncrement()}"
      val shell = EchoShell(id) { event, payload -> sendEvent(event, payload) }
      synchronized(backends) { backends[id] = shell }
      if (banner.isNotEmpty()) shell.banner(banner)
      id
    }

    Function("connect") {
        host: String, port: Int, username: String, password: String,
        privateKey: String, passphrase: String, timeoutMs: Int ->
      val id = "ssh-${counter.getAndIncrement()}"
      val connection = SecureShellConnection(
        sessionId = id,
        host = host,
        port = port,
        username = username,
        password = password,
        privateKey = privateKey,
        passphrase = passphrase,
        timeoutMs = timeoutMs,
        emit = { event, payload -> sendEvent(event, payload) }
      )
      synchronized(backends) { backends[id] = connection }
      connection.start()
      id
    }

    Function("respondHostKey") { sessionId: String, accept: Boolean ->
      (synchronized(backends) { backends[sessionId] } as? SecureShellConnection)?.respondHostKey(accept)
    }

    Function("openShell") { sessionId: String, cols: Int, rows: Int ->
      (synchronized(backends) { backends[sessionId] } as? SecureShellConnection)?.openShell(cols, rows)
    }

    Function("write") { sessionId: String, data: ByteArray ->
      synchronized(backends) { backends[sessionId] }?.write(data)
    }

    Function("read") { sessionId: String, maxBytes: Int ->
      synchronized(backends) { backends[sessionId] }?.read(maxBytes)
    }

    Function("resize") { sessionId: String, cols: Int, rows: Int ->
      synchronized(backends) { backends[sessionId] }?.resize(cols, rows)
    }

    Function("close") { sessionId: String ->
      synchronized(backends) { backends[sessionId] }?.close()
    }

    Function("disconnect") { sessionId: String ->
      val backend = synchronized(backends) { backends.remove(sessionId) }
      backend?.disconnect()
    }

    OnDestroy {
      val all = synchronized(backends) {
        val copy = backends.values.toList()
        backends.clear()
        copy
      }
      all.forEach { it.disconnect() }
    }
  }
}
