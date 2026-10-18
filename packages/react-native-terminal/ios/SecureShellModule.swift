import ExpoModulesCore

/// Expo module surface for `@literm/react-native-terminal` (iOS, libssh2 backend).
///
/// The module stays thin: it maps the JS contract onto `SecureShellSession`
/// and re-emits session callbacks as events. All protocol work (handshake,
/// host-key gate, auth, channel, flow control) lives in the ObjC session.
public class SecureShellModule: Module {
  private var sessions: [String: SecureShellSession] = [:]
  private var counter = 0
  private let lock = NSLock()

  private func nextId() -> String {
    lock.lock()
    defer { lock.unlock() }
    let id = "ssh-\(counter)"
    counter += 1
    return id
  }

  private func session(_ id: String) -> SecureShellSession? {
    lock.lock()
    defer { lock.unlock() }
    return sessions[id]
  }

  private func store(_ session: SecureShellSession, id: String) {
    lock.lock()
    sessions[id] = session
    lock.unlock()
  }

  @discardableResult
  private func remove(_ id: String) -> SecureShellSession? {
    lock.lock()
    defer { lock.unlock() }
    return sessions.removeValue(forKey: id)
  }

  public func definition() -> ModuleDefinition {
    Name("SecureShell")

    Events("onDataAvailable", "onClose", "onHostKey", "onConnected", "onError")

    /// Build verification: the bundled libssh2 version.
    Function("libssh2Version") { () -> String in
      SecureShellLibssh2Version()
    }

    /// Starts the handshake off-thread and returns a sessionId immediately.
    /// `privateKey` wins over `password` when both are present.
    Function("connect") {
      (host: String, port: Int, username: String, password: String,
       privateKey: String, passphrase: String, timeoutMs: Int) -> String in
      let id = self.nextId()
      let auth: SecureShellAuthMethod = privateKey.isEmpty ? .password : .privateKey

      let session = SecureShellSession(
        host: host,
        port: port,
        username: username,
        auth: auth,
        password: password.isEmpty ? nil : password,
        privateKey: privateKey.isEmpty ? nil : privateKey,
        passphrase: passphrase.isEmpty ? nil : passphrase,
        timeoutMs: timeoutMs
      )

      session.onHostKey = { [weak self] algorithm, sha256, knownHostsLine in
        self?.sendEvent("onHostKey", [
          "sessionId": id,
          "host": host,
          "port": port,
          "algorithm": algorithm,
          "sha256": sha256,
          "knownHostsLine": knownHostsLine,
        ])
      }
      session.onConnected = { [weak self] in
        self?.sendEvent("onConnected", ["sessionId": id])
      }
      session.onDataAvailable = { [weak self] in
        self?.sendEvent("onDataAvailable", ["sessionId": id])
      }
      session.onError = { [weak self] message in
        self?.sendEvent("onError", ["sessionId": id, "message": message])
      }
      session.onClose = { [weak self] reason in
        self?.sendEvent("onClose", ["sessionId": id, "reason": reason])
        self?.remove(id)
      }

      self.store(session, id: id)
      session.start()
      return id
    }

    Function("respondHostKey") { (sessionId: String, accept: Bool) in
      self.session(sessionId)?.respondHostKey(accept)
    }

    Function("openShell") { (sessionId: String, cols: Int, rows: Int) in
      self.session(sessionId)?.openShellCols(cols, rows: rows)
    }

    Function("write") { (sessionId: String, data: Data) in
      self.session(sessionId)?.write(data)
    }

    Function("read") { (sessionId: String, maxBytes: Int) -> Data? in
      self.session(sessionId)?.read(maxBytes)
    }

    Function("resize") { (sessionId: String, cols: Int, rows: Int) in
      self.session(sessionId)?.resizeCols(cols, rows: rows)
    }

    Function("close") { (sessionId: String) in
      self.session(sessionId)?.disconnect()
    }

    Function("disconnect") { (sessionId: String) in
      self.remove(sessionId)?.disconnect()
    }

    OnDestroy {
      self.lock.lock()
      let all = Array(self.sessions.values)
      self.sessions.removeAll()
      self.lock.unlock()
      all.forEach { $0.disconnect() }
    }
  }
}
