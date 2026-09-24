import Foundation
import Security
import UserNotifications
import WebKit

/// 壳能力桥 —— 前端 kernel/shellBridge.ts 的 Swift 对端。
/// 帧协议:postMessage {id, method, args} → 分发 → window.__TMD_SHELL_RESULT__(id, ok, payload|error)。
/// 能力:notify(本地通知)/ creds.get/set/delete(iOS 钥匙串)。
/// 这些是手机本机能力,不经桌面桥、不进 AppDevice 白名单。
final class ShellBridge: NSObject, WKScriptMessageHandler {
  static let shared = ShellBridge()
  weak var webview: WKWebView?

  func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any],
          let id = body["id"] as? Int,
          let method = body["method"] as? String else { return }
    let args = body["args"] as? [String: Any]
    switch method {
    case "notify":
      notify(id: id, args: args ?? [:])
    case "log":
      /* 页面诊断通道:前端把 mount 态/JS 错误写进 Documents/shell.log(id=0 无应答方) */
      ShellLog.write(String(describing: args?["line"] ?? ""))
    case "creds.get":
      reply(id: id, ok: true, payload: Keychain.read())
    case "creds.set":
      guard let json = args?["json"] as? String else { reply(id: id, ok: false, payload: "missing json"); return }
      reply(id: id, ok: Keychain.write(json), payload: nil)
    case "creds.delete":
      Keychain.delete()
      reply(id: id, ok: true, payload: nil)
    case "ws.open":
      /* 连接号取 args.id(信封 id 是请求号;回注按连接号分发,两套不能混) */
      if let cid = args?["id"] as? Int,
         let urlStr = args?["url"] as? String, let url = URL(string: urlStr) {
        WsTunnel.shared.open(id: cid, url: url, webview: webview)
      } else {
        reply(id: id, ok: false, payload: "ws.open: bad args")
      }
    case "ws.send":
      WsTunnel.shared.send(id: args?["id"] as? Int ?? 0, text: args?["data"] as? String ?? "")
    case "ws.close":
      WsTunnel.shared.close(id: args?["id"] as? Int ?? 0)
    case "http.post":
      httpPost(id: id, args: args ?? [:])
    case "screen.orient":
      /* 横竖屏切换(iOS16+):plist 须含全部方向;完成回调在私有队列,
         reply 里的 evaluateJavaScript 必须回主线程(WebKit 铁律) */
      let mode = args?["mode"] as? String ?? "portrait"
      guard let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene else {
        reply(id: id, ok: false, payload: "no active scene"); return
      }
      let mask: UIInterfaceOrientationMask = mode == "landscape" ? [.landscapeLeft, .landscapeRight] : .portrait
      /* requestGeometryUpdate 的 completionHandler 只在失败时调用(成功永不回 →
         JS promise 永挂);用 async 变体拿全两路,成败都诚实回话。 */
      Task { @MainActor in
        do { try await scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)); self.reply(id: id, ok: true, payload: nil) }
        catch { self.reply(id: id, ok: false, payload: "\(error)") }
      }
    default:
      reply(id: id, ok: false, payload: "unknown method \(method)")
    }
  }
  /// 壳原生 POST(自签中继场景:WKWebView fetch 无法信任自签证书,
  /// /pair 下沉到这里,走 PinnedTLS 证书锁定)。应答 {status, body}。
  private func httpPost(id: Int, args: [String: Any]) {
    guard let urlStr = args["url"] as? String, let url = URL(string: urlStr),
          let body = args["body"] as? String else {
      reply(id: id, ok: false, payload: "http.post: bad args"); return
    }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "content-type")
    req.httpBody = Data(body.utf8)
    req.timeoutInterval = 8
    PinnedHttp.dataTask(with: req) { data, resp, err in
      if let err { self.reply(id: id, ok: false, payload: err.localizedDescription); return }
      let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
      let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
      self.reply(id: id, ok: true, payload: ["status": status, "body": text])
    }.resume()
  }

  /// 权限未决/被拒 → 静默成功(应用内横幅照旧,spec 降级路径)。
  private func notify(id: Int, args: [String: Any]) {
    let title = args["title"] as? String ?? "tmd-cli"
    let body = args["body"] as? String ?? ""
    let center = UNUserNotificationCenter.current()
    center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
      guard granted else { self.reply(id: id, ok: true, payload: "denied"); return }
      let content = UNMutableNotificationContent()
      content.title = title
      content.body = body
      content.sound = .default
      let req = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
      center.add(req) { _ in self.reply(id: id, ok: true, payload: nil) }
    }
  }

  private func reply(id: Int, ok: Bool, payload: Any?) {
    /* WebKit 铁律:evaluateJavaScript 必须回主线程(UN requestAuthorization/add 回调
       在后台队列,直调 = 真机 crash;2026-09-24 评审抓到 notify 路径漏网)。 */
    guard Thread.isMainThread else {
      DispatchQueue.main.async { self.reply(id: id, ok: ok, payload: payload) }
      return
    }
    let json: String
    if let payload {
      json = (try? JSONSerialization.data(withJSONObject: ["p": payload]))
        .flatMap { String(data: $0, encoding: .utf8) } ?? "{\"p\":null}"
    } else { json = "{\"p\":null}" }
    // payload 经 {"p":…} 包裹再序列化,避免字符串双重转义;
    // (…) 括号为防御写法(evaluateJavaScript 按 program 求值,表达式位本无歧义)。
    webview?.evaluateJavaScript("window.__TMD_SHELL_RESULT__ && window.__TMD_SHELL_RESULT__(\(id), \(ok ? "true" : "false"), (\(json))[\"p\"])")
  }
}

/// 壳 WS 隧道:iOS WKWebView 的自定义 scheme 页面(app://tmd)发不出 ws://
/// (WebKit 限制:fetch 可用、WebSocket 不可用,Tauri iOS 同类问题)。JS 侧经
/// shell 桥发连接意图,这里用 URLSessionWebSocketTask 建连(无 origin 限制),
/// 帧回注 window.__TMD_SHELL_WS__(connId, event, payload);对端是 kernel/shellWs.ts。
final class WsTunnel {
  static let shared = WsTunnel()
  /* 自签中继证书钉住(PinnedTLS);非钉住主机走系统默认校验。 */
  private let session = URLSession(configuration: .default, delegate: PinnedDelegate.shared, delegateQueue: nil)
  private var tasks: [Int: URLSessionWebSocketTask] = [:]
  private var opened: Set<Int> = []
  weak var webview: WKWebView?

  /* URLSession 回调在后台线程;evaluateJavaScript 是主线程专用 API(后台直调 =
   * WebKit 主动 crash),tasks/opened 状态也一律回主线程改,免锁。 */
  private func onMain(_ block: @escaping () -> Void) {
    DispatchQueue.main.async(execute: block)
  }

  private func emit(_ id: Int, _ event: String, _ payload: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          let json = String(data: data, encoding: .utf8) else { return }
    let js = "window.__TMD_SHELL_WS__ && window.__TMD_SHELL_WS__(\(id), \"\(event)\", \(json))"
    onMain { [weak self] in
      self?.webview?.evaluateJavaScript(js) { _, error in
        if let error { ShellLog.write("js eval err: \(error)") }
      }
    }
  }

  /// 建连:resume 后立即挂 receive,首帧(含服务端拒绝的 bye)即视为已开。
  /// 不用 sendPing 探测 open —— 对方若不回 pong(URLSession 无超时)会永久挂起。
  func open(id: Int, url: URL, webview: WKWebView?) {
    onMain {
      self.webview = webview
      self.opened.remove(id)
      self.tasks[id]?.cancel(with: .goingAway, reason: nil)
      let task = self.session.webSocketTask(with: url)
      self.tasks[id] = task
      task.resume()
      ShellLog.write("ws dial id=\(id) host=\(url.host ?? "?") port=\(url.port ?? -1)")
      self.receive(id: id, task: task)
    }
  }

  private func receive(id: Int, task: URLSessionWebSocketTask) {
    task.receive { [weak self] result in
      self?.onMain {
        guard let self, self.tasks[id] === task else { return }
        switch result {
        case .success(.string(let text)):
          self.markOpen(id)
          self.emit(id, "message", ["data": text])
          self.receive(id: id, task: task)
        case .success(.data(let data)):
          self.markOpen(id)
          self.emit(id, "message", ["b64": data.base64EncodedString()])
          self.receive(id: id, task: task)
        case .success:
          self.receive(id: id, task: task)
        case .failure(let error):
          self.tasks[id] = nil
          let wasOpen = self.opened.remove(id) != nil
          ShellLog.write("ws close id=\(id) open=\(wasOpen): \(error)")
          self.emit(id, "close", ["code": 1006, "reason": "\(error)"])
        }
      }
    }
  }

  private func markOpen(_ id: Int) {
    guard !opened.contains(id) else { return }
    opened.insert(id)
    emit(id, "open", [:])
  }

  func send(id: Int, text: String) {
    onMain { [weak self] in
      guard let task = self?.tasks[id] else { return }
      task.send(.string(text)) { _ in } // 发送失败由 close 事件承载
    }
  }

  func close(id: Int) {
    onMain {
      self.opened.remove(id)
      self.tasks.removeValue(forKey: id)?.cancel(with: .goingAway, reason: nil)
    }
  }
}

/// iOS 钥匙串:单账号位存凭证 JSON(AfterFirstUnlockThisDeviceOnly —— 备份不携带,设备绑定)。
enum Keychain {
  private static let service = "com.tmdcli.mobile.creds"
  private static let account = "tmd.mobile.creds.v1"

  static func read() -> String? {
    let q: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var out: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
          let data = out as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  @discardableResult
  static func write(_ json: String) -> Bool {
    let data = Data(json.utf8)
    let base: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    if SecItemCopyMatching(base as CFDictionary, nil) == errSecSuccess {
      return SecItemUpdate(base as CFDictionary, [kSecValueData as String: data] as CFDictionary) == errSecSuccess
    }
    var add = base
    add[kSecValueData as String] = data
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
  }

  static func delete() {
    let base: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    /* 状态进 shell.log:静默失败(ACL/锁定态)会让前端凭证"删不掉"无从排查 */
    let status = SecItemDelete(base as CFDictionary)
    ShellLog.write("keychain delete status=\(status)")
  }
}
