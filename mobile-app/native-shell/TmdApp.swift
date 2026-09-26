import SwiftUI
import WebKit
import AVFoundation
import PhotosUI

/// tmd-cli 移动壳:原生 WKWebView 容器,数据面全部走 WebSocket 连桌面桥。
/// 页面经 WKURLSchemeHandler 以 app://tmd/ 为根服务内嵌 dist —— 不能用 file://,
/// 前端产物是绝对路径(/assets/…),file:// 下会解析到文件系统根导致白屏。
/// 扫码配对经 WKScriptMessageHandler("qr")桥接原生 AVCapture 二维码扫描。
/// 壳零原生命令面;M2 的通知/钥匙串经 WKScriptMessageHandler 扩展。
@main
struct TmdApp: App {
  var body: some Scene {
    WindowGroup { ShellView() }
  }
}

struct ShellView: View {
  var body: some View { WebView().ignoresSafeArea() }
}

/// 诊断日志:写沙箱 Documents/shell.log,用 devicectl 拉取
enum ShellLog {
  static let url: URL = {
    let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    return dir.appendingPathComponent("shell.log")
  }()
  static func write(_ s: String) {
    let line = "[\(Date())] \(s)\n"
    /* 轮转:超 5MB 删档重建(故障风暴曾把日志撑到 409MB) */
    if let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
       let size = attrs[.size] as? UInt64, size > 5_000_000 {
      try? FileManager.default.removeItem(at: url)
    }
    if let h = try? FileHandle(forWritingTo: url) {
      h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close()
    } else {
      try? line.write(to: url, atomically: true, encoding: .utf8)
    }
  }
}

/// 把 bundle 内 dist/ 目录映射为 app://tmd/<path> 的静态服务器
final class DistSchemeHandler: NSObject, WKURLSchemeHandler {
  static let shared = DistSchemeHandler()
  private let root: URL? = Bundle.main.url(forResource: "dist", withExtension: nil)?.standardizedFileURL

  private static let mime: [String: String] = [
    "html": "text/html", "js": "text/javascript", "mjs": "text/javascript",
    "css": "text/css", "json": "application/json", "svg": "image/svg+xml",
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
    "webp": "image/webp", "gif": "image/gif", "ico": "image/x-icon",
    "woff": "font/woff", "woff2": "font/woff2", "ttf": "font/ttf",
    "map": "application/json", "wasm": "application/wasm",
  ]

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url, url.scheme == "app", let root else {
      ShellLog.write("404 no-root \(task.request.url?.absoluteString ?? "?")")
      task.didFailWithError(NSError(domain: "tmd", code: 404))
      return
    }
    // 防目录穿越:root 已 standardizedFileURL,与 file 同基准比较(避免 /private 前缀差异)
    var path = url.path
    if path.isEmpty || path == "/" { path = "/index.html" }
    let file = root.appendingPathComponent(path).standardizedFileURL
    guard file.path.hasPrefix(root.path + "/") || file == root else {
      ShellLog.write("404 escape \(file.path) vs \(root.path)")
      task.didFailWithError(NSError(domain: "tmd", code: 404))
      return
    }
    let data: Data
    do {
      data = try Data(contentsOf: file)
    } catch {
      ShellLog.write("404 read \(file.path) err=\(error.localizedDescription)")
      task.didFailWithError(NSError(domain: "tmd", code: 404))
      return
    }
    let ext = file.pathExtension.lowercased()
    ShellLog.write("200 \(url.absoluteString) (\(data.count)B \(ext))")
    let resp = HTTPURLResponse(
      url: url, statusCode: 200,
      httpVersion: "HTTP/1.1",
      headerFields: [
        "Content-Type": Self.mime[ext] ?? "application/octet-stream",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
      ]
    )!
    task.didReceive(resp)
    task.didReceive(data)
    task.didFinish()
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

/// 全屏 QR 扫描页:扫到即回调,取消回调 nil
final class QrScannerVC: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
  var onResult: ((String?) -> Void)?
  private var session: AVCaptureSession?
  private var preview: AVCaptureVideoPreviewLayer?

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    guard let device = AVCaptureDevice.default(for: .video),
          let input = try? AVCaptureDeviceInput(device: device) else { finish(nil); return }
    let s = AVCaptureSession()
    s.beginConfiguration()
    if s.canAddInput(input) { s.addInput(input) }
    let output = AVCaptureMetadataOutput()
    if s.canAddOutput(output) { s.addOutput(output) }
    s.commitConfiguration()
    output.setMetadataObjectsDelegate(self, queue: .main)
    output.metadataObjectTypes = [.qr]
    let p = AVCaptureVideoPreviewLayer(session: s)
    p.videoGravity = .resizeAspectFill
    p.frame = view.bounds
    view.layer.addSublayer(p)
    preview = p

    let hint = UILabel()
    hint.text = "将桌面端配对二维码对准取景框"
    hint.textColor = .white
    hint.backgroundColor = UIColor.black.withAlphaComponent(0.6)
    hint.textAlignment = .center
    hint.font = .systemFont(ofSize: 15, weight: .medium)
    hint.layer.cornerRadius = 10
    hint.clipsToBounds = true
    hint.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(hint)
    NSLayoutConstraint.activate([
      hint.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      hint.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -40),
      hint.widthAnchor.constraint(equalToConstant: 260),
      hint.heightAnchor.constraint(equalToConstant: 40),
    ])

    let cancel = UIButton(type: .system)
    cancel.setTitle("取消", for: .normal)
    cancel.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
    cancel.setTitleColor(.white, for: .normal)
    cancel.backgroundColor = UIColor.white.withAlphaComponent(0.15)
    cancel.layer.cornerRadius = 18
    cancel.addTarget(self, action: #selector(cancelled), for: .touchUpInside)
    cancel.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(cancel)
    NSLayoutConstraint.activate([
      cancel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
      cancel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
      cancel.widthAnchor.constraint(equalToConstant: 72),
      cancel.heightAnchor.constraint(equalToConstant: 36),
    ])
    session = s
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    preview?.frame = view.bounds
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    if let s = session, !s.isRunning {
      DispatchQueue.global(qos: .userInitiated).async { s.startRunning() }
    }
  }

  @objc private func cancelled() { finish(nil) }

  private func finish(_ text: String?) {
    session?.stopRunning()
    onResult?(text)
    dismiss(animated: true)
  }

  func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
    guard let obj = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
          let text = obj.stringValue else { return }
    AudioServicesPlaySystemSound(SystemSoundID(kSystemSoundID_Vibrate))
    finish(text)
  }
}

/// JS 桥:window.webkit.messageHandlers.qr.postMessage("start") 开扫;
/// 结果经 window.__TMD_QR__(text|null) 回传前端。
final class QrBridge: NSObject, WKScriptMessageHandler {
  static let shared = QrBridge()
  weak var webview: WKWebView?

  func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.frameInfo.isMainFrame,
          (message.body as? String) == "start" else { return }
    DispatchQueue.main.async {
      AVCaptureDevice.requestAccess(for: .video) { granted in
        DispatchQueue.main.async {
          guard granted,
                let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                let root = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController
          else { self.deliver(nil); return }
          let vc = QrScannerVC()
          vc.modalPresentationStyle = .fullScreen
          vc.onResult = { [weak self] text in self?.deliver(text) }
          root.present(vc, animated: true)
        }
      }
    }
  }

  private func deliver(_ text: String?) {
    let payload: String
    if let text {
      payload = (try? JSONEncoder().encode(text)).flatMap { String(data: $0, encoding: .utf8) } ?? "null"
    } else { payload = "null" }
    webview?.evaluateJavaScript("window.__TMD_QR__ && window.__TMD_QR__(\(payload))")
  }
}

struct WebView: UIViewRepresentable {
  private let handler = DistSchemeHandler.shared

  func makeUIView(context: Context) -> WKWebView {
    ShellLog.write("== launch; root=\(Bundle.main.url(forResource: "dist", withExtension: nil)?.path ?? "nil")")
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default() // app://tmd origin 下 localStorage 持久(凭证)
    config.setURLSchemeHandler(handler, forURLScheme: "app")
    config.userContentController.addUserScript(WKUserScript(
      source: "window.__TMD_SHELL__ = 'mobile';",
      injectionTime: .atDocumentStart,
      forMainFrameOnly: true
    ))
    /* 真实设备名(系统设置里用户起的名字)上报桌面,设备列表靠它区分多机。
       出厂默认名(iPhone/iPad,用户没改过)拼硬件标识(utsname.machine,如 iPhone17,1),
       多台默认名手机也可区分;配对与重连拨号共用这一个最终名。 */
    var uts = utsname()
    uname(&uts)
    let machine = withUnsafeBytes(of: &uts.machine) { raw in
      String(cString: raw.baseAddress!.assumingMemoryBound(to: CChar.self))
    }
    var composed = UIDevice.current.name
    if ["iPhone", "iPad", "iPod", "手机"].contains(composed), !machine.isEmpty {
      composed += "(\(machine))"
    }
    let escaped = composed
      .replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "\"", with: "\\\"")
    config.userContentController.addUserScript(WKUserScript(
      source: "window.__TMD_DEVICE_NAME__ = \"\(escaped)\";",
      injectionTime: .atDocumentStart,
      forMainFrameOnly: true
    ))

    config.userContentController.add(QrBridge.shared, name: "qr")
    config.userContentController.add(ShellBridge.shared, name: "shell")
    let webview = WKWebView(frame: .zero, configuration: config)
    webview.backgroundColor = .black
    webview.scrollView.bounces = false
    webview.navigationDelegate = context.coordinator
    webview.uiDelegate = FileUploadBridge.shared /* <input type=file>:不挂 uiDelegate 是静默死钮 */
    QrBridge.shared.webview = webview
    ShellBridge.shared.webview = webview
    webview.load(URLRequest(url: URL(string: "app://tmd/index.html")!))
    return webview
  }

  func updateUIView(_ uiView: WKWebView, context: Context) {}
  func makeCoordinator() -> NavLog { NavLog() }
}

final class NavLog: NSObject, WKNavigationDelegate {
  /// 导航闸:壳内容是自有 app:// 静态包,主帧没有合法理由跳外部。放行外部导航 =
  /// 任意网页拿到 shell 桥(creds.get/http.post)——整个钉住体系被一次跳转旁路。
  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    let ok = navigationAction.request.url?.scheme == "app"
      || navigationAction.targetFrame?.isMainFrame != true // 子帧资源放行(自有页内嵌图等)
    decisionHandler(ok ? .allow : .cancel)
  }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    ShellLog.write("nav FAIL \(error.localizedDescription)")
  }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    ShellLog.write("nav PROVISIONAL-FAIL \(error.localizedDescription)")
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    ShellLog.write("nav didFinish")
  }
}

/// <input type=file> 宿主面板:不挂 WKUIDelegate 时 file input 是静默死钮
/// (2026-09-26 功能查漏 P1-4)。PHPicker 出程选图,不经相册权限(iOS 14+);
/// 单选即可满足截图注入场景,多选随 parameters.allowsMultipleSelection 放开。
final class FileUploadBridge: NSObject, WKUIDelegate {
  static let shared = FileUploadBridge()

  func webView(_ webView: WKWebView,
               runFileUploadPanelInFrame frame: WKFrameInfo?,
               parameters: WKFileUploadPanelParameters,
               completionHandler: @escaping ([URL]?) -> Void) {
    guard let root = UIApplication.shared.connectedScenes
      .compactMap({ $0 as? UIWindowScene })
      .flatMap({ $0.windows })
      .first(where: { $0.isKeyWindow })?.rootViewController else {
      completionHandler(nil)
      return
    }
    var config = PHPickerConfiguration()
    config.filter = .images
    config.selectionLimit = parameters.allowsMultipleSelection ? 0 : 1
    let picker = PHPickerViewController(configuration: config)
    let relay = FilePanelRelay()
    relay.completion = completionHandler
    relay.present(root, picker)
  }
}

/// PHPicker 结果拷到自有临时位再回传(系统的 representation 文件会被回收)。
/// completionHandler 必须恰好调用一次:取消/失败/成功三路都经 finish 收口。
private final class FilePanelRelay: NSObject, PHPickerViewControllerDelegate {
  var completion: (([URL]?) -> Void)?
  private var done = false

  func present(_ root: UIViewController, _ picker: PHPickerViewController) {
    picker.delegate = self
    root.present(picker, animated: true)
  }

  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    picker.dismiss(animated: true)
    guard !done else { return }
    guard let provider = results.first?.itemProvider,
          provider.hasItemConformingToTypeIdentifier("public.image") else {
      finish(nil)
      return
    }
    provider.loadFileRepresentation(forTypeIdentifier: "public.image") { [weak self] url, _ in
      guard let self, let url else { self?.finish(nil); return }
      let tmp = FileManager.default.temporaryDirectory
        .appendingPathComponent("tmd-upload-\(Int(Date().timeIntervalSince1970 * 1000)).\(url.pathExtension.isEmpty ? "jpg" : url.pathExtension)")
      try? FileManager.default.copyItem(at: url, to: tmp)
      DispatchQueue.main.async { self.finish([tmp]) }
    }
  }

  private func finish(_ urls: [URL]?) {
    guard !done else { return }
    done = true
    completion?(urls)
    completion = nil
  }
}
