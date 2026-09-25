import CryptoKit
import Foundation

/// 自建中继的证书钉住。运营商对所有端口做 WS 深包检测
/// (80 吞 upgrade、443 嗅探 TLS),明文无解 → 443 上真 TLS(自签证书);
/// 信任模型 = 不信任公共 CA:内置指纹(烧进二进制,换证书 = 重发版)+
/// 配对下发的钥匙串 creds pin(任意自建 host,见 credsMatch)。
/// 与桌面 src-tauri/src/web/pinned_tls.rs 同语义。
enum PinnedTLS {
  static let host = "123.249.45.144"
  /// deploy/relay/relay-cert.der 的 base64(十年期自签;换证书 = 换这里重发版)。
  static let certDerBase64 = """
MIIDGjCCAgKgAwIBAgIUQaHQQlixHbZ7RiDywK6yJmvJ1YIwDQYJKoZIhvcNAQELBQ\
AwFDESMBAGA1UEAwwJdG1kLXJlbGF5MB4XDTI2MDkyNDA0NDUwNVoXDTM2MDkyMTA0\
NDUwNVowFDESMBAGA1UEAwwJdG1kLXJlbGF5MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ\
8AMIIBCgKCAQEAj8bM7nEzmzXZud+7s9IisUPJjWtsj3Rddv6OTvv2r0nyTUo0Y+f4\
kHbN5WtJ0RzjptLHrc3t9eaL3Upqy+/rh6rYa3DW4O53MvePiB6QmkwNFXRmv8O57A\
tG75E4ukYFVxbJxmOJqpHX0E+LHJsVpWpaiAFQeEdfMH3uY5skM+vvkCEfxloJLwZ5\
bm6fds4eme2ayM9gY6p3OHZ3VZ+Nq+Bx8p6jlc8qsDBI49KMPAU2KxMiaO/DHVLFCj\
PPsuOrywA7Nk6y7WaLkNTrw23EX67UxE8JnwYEabz/KzupsPfPeq7vj4HiX7KplTYI\
gxYDND8i1nQ24vRkxCqW7GapFwIDAQABo2QwYjAdBgNVHQ4EFgQUeK8oUtkIIAHveJ\
dU5GiUnPq+8ZQwHwYDVR0jBBgwFoAUeK8oUtkIIAHveJdU5GiUnPq+8ZQwDwYDVR0T\
AQH/BAUwAwEB/zAPBgNVHREECDAGhwR7+S2QMA0GCSqGSIb3DQEBCwUAA4IBAQBE96\
d2BkGW1gLA1DuAWPh8/4Gk6TmfBvhyHQ7MBWEHwLk+FmGs01EYeXVaokegmdj1GPne\
9DOlMllcy1jpFORfEPRCQ+/AAmv2pRzg577z9GBjvfumA3CjcEQmqYH74gjX9udcxL\
3Jq8xEfNVey8zVwKpSMklGt3VNGimBBgjo3Ijm5F+UTQuHm0x195Yoe1ry98JefUV1\
UvhxT6xW2YtIOZaDDyI1YWhJL+sxpbMj63MuA50Yr/eu/UyfubGcv15/WV9s2YeVTH\
EeQNZfdbPT81HC3vVFCJDDLHMLq8fZRvstDgS/SHOMpcm0Hx++yzMdfzQTdETC3ADa\
EGVrEuDU
"""

  static let certDer: Data? = Data(base64Encoded: certDerBase64)

  static func isPinned(_ host: String?) -> Bool { host == PinnedTLS.host }

  static func matches(_ der: Data) -> Bool {
    guard let expected = certDer else { return false }
    return der == expected
  }

  /// 钥匙串凭证回落钉住:配对 offer 带 pin(证书 DER 的 SHA-256 base64)+ pinHost
  /// (src/mobile/creds.ts MobileCreds)。读取复用 ShellBridge.swift 的 Keychain.read
  /// (同步 SecItemCopyMatching,challenge 回调线程可调)。host 不等、JSON 解析失败、
  /// pin 缺失/不等一律返回 false,静默走拒绝分支。
  static func credsMatch(host: String, der: Data) -> Bool {
    guard let json = Keychain.read(),
          let data = json.data(using: .utf8),
          let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let pin = obj["pin"] as? String, !pin.isEmpty,
          let pinHost = obj["pinHost"] as? String, pinHost == host
    else { return false }
    let digest = Data(SHA256.hash(data: der)).base64EncodedString()
    return b64Equal(pin, digest)
  }

  /// base64 宽松比对:容忍 base64url 变体与 padding 差异(签发端编码不做强约定)。
  private static func b64Equal(_ a: String, _ b: String) -> Bool {
    func norm(_ s: String) -> String {
      s.replacingOccurrences(of: "-", with: "+")
        .replacingOccurrences(of: "_", with: "/")
        .replacingOccurrences(of: "=", with: "")
    }
    return norm(a) == norm(b)
  }
}

/// 证书钉住 URLSession delegate(WS 与 /pair 共用):钉住主机比对证书 DER,
/// 其余主机走系统默认校验。
final class PinnedDelegate: NSObject, URLSessionDelegate {
  static let shared = PinnedDelegate()

  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    guard let trust = challenge.protectionSpace.serverTrust,
          let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
          let leaf = chain.first,
          let certData = SecCertificateCopyData(leaf) as Data?
    else {
      completionHandler(.performDefaultHandling, nil)
      return
    }
    let host = challenge.protectionSpace.host
    // 内置指纹命中,或失败后回落钥匙串 creds pin;自签证书没有 CA 链,
    // performDefaultHandling 必被系统打回 → 指纹命中一律 useCredential 显式放行。
    if (PinnedTLS.isPinned(host) && PinnedTLS.matches(certData))
      || PinnedTLS.credsMatch(host: host, der: certData) {
      completionHandler(.useCredential, URLCredential(trust: trust))
    } else {
      completionHandler(.performDefaultHandling, nil)
    }
  }
}

/// 一次性 pin delegate:配对时 offer 带 pin(扫码即信任,TOFU)——此时钥匙串
/// 还没有 creds,credsMatch 必然落空(鸡生蛋死锁,2026-09-24 实证),故 /pair
/// 请求现场带 pin,叶证书 SHA-256 命中即放行。
final class OneShotPinDelegate: NSObject, URLSessionDelegate {
  private let pin: Data
  init(pin: Data) { self.pin = pin }

  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    guard let trust = challenge.protectionSpace.serverTrust,
          let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
          let leaf = chain.first,
          let certData = SecCertificateCopyData(leaf) as Data?,
          Data(SHA256.hash(data: certData)) == pin
    else {
      completionHandler(.performDefaultHandling, nil)
      return
    }
    completionHandler(.useCredential, URLCredential(trust: trust))
  }
}

/// 壳原生 HTTP(自签中继的 /pair;WKWebView fetch 过不了自签校验)。
enum PinnedHttp {
  static let session: URLSession = {
    let cfg = URLSessionConfiguration.ephemeral
    cfg.waitsForConnectivity = false
    return URLSession(configuration: cfg, delegate: PinnedDelegate.shared, delegateQueue: nil)
  }()

  static func dataTask(
    with request: URLRequest,
    pin: String? = nil,
    completionHandler: @escaping (Data?, URLResponse?, Error?) -> Void
  ) -> URLSessionDataTask {
    if let pin, let pinData = b64DecodeLenient(pin) {
      let cfg = URLSessionConfiguration.ephemeral
      cfg.waitsForConnectivity = false
      let s = URLSession(configuration: cfg, delegate: OneShotPinDelegate(pin: pinData), delegateQueue: nil)
      // session 必须活到任务结束:由 completion 后释放。
      let task = s.dataTask(with: request) { data, resp, err in
        s.invalidateAndCancel()
        completionHandler(data, resp, err)
      }
      return task
    }
    return session.dataTask(with: request, completionHandler: completionHandler)
  }

  /// base64url/padding 宽松解码(与 PinnedDelegate.b64Equal 同规则):
  /// strip 后必须重补 '='——Foundation 严格要求 padding,43 字符(%4=3)会解出
  /// nil → 静默降级无钉会话,配对必失败且无因可查(签发端恒 STANDARD 带 '=')。
  private static func b64DecodeLenient(_ s: String) -> Data? {
    let norm = s.replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
      .replacingOccurrences(of: "=", with: "")
    let padded = norm + String(repeating: "=", count: (4 - norm.count % 4) % 4)
    return Data(base64Encoded: padded)
  }
}
