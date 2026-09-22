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
    case "creds.get":
      reply(id: id, ok: true, payload: Keychain.read())
    case "creds.set":
      guard let json = args?["json"] as? String else { reply(id: id, ok: false, payload: "missing json"); return }
      reply(id: id, ok: Keychain.write(json), payload: nil)
    case "creds.delete":
      Keychain.delete()
      reply(id: id, ok: true, payload: nil)
    default:
      reply(id: id, ok: false, payload: "unknown method \(method)")
    }
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
    SecItemDelete(base as CFDictionary)
  }
}
