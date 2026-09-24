import Foundation

/// 自建中继(123.249.45.144)的证书钉住。运营商对所有端口做 WS 深包检测
/// (80 吞 upgrade、443 嗅探 TLS),明文无解 → 443 上真 TLS(自签证书);
/// 信任模型 = 不信任公共 CA,只认这张烧进二进制的证书(逐字节比对 DER)。
/// 与桌面 src-tauri/src/web/pinned_tls.rs 同证书、同语义。
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
          PinnedTLS.isPinned(challenge.protectionSpace.host),
          let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
          let leaf = chain.first,
          let certData = SecCertificateCopyData(leaf) as Data?,
          PinnedTLS.matches(certData)
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
    completionHandler: @escaping (Data?, URLResponse?, Error?) -> Void
  ) -> URLSessionDataTask {
    session.dataTask(with: request, completionHandler: completionHandler)
  }
}
