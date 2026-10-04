package com.tmdcli.mobile

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.content.FileProvider
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import com.google.zxing.integration.android.IntentIntegrator
import java.io.File

/// 安卓壳入口 —— 对齐 iOS TmdApp/ShellView:
/// 资产挂载把 assets/dist 挂到 https://appassets.androidplatform.net 域根
/// (dist/index.html 用根绝对路径 /assets/...,挂域根才原样命中;https origin 下
/// localStorage 持久可靠)。addDocumentStartJavaScript 先于模块求值注入
/// window.__TMD_SHELL__='mobile'(等价 WKUserScript atDocumentStart)。
/// WS/自签 http 全部走原生隧道与钉住(ShellBridge/WsTunnel/PinnedTls);
/// 选图/拍照/扫码经 Activity result 回灌 ShellBridge(见 onActivityResult)。
class MainActivity : android.app.Activity() {
    private lateinit var webView: WebView
    private lateinit var bridge: ShellBridge
    private var permCallback: ((Boolean) -> Unit)? = null
    private val main = Handler(Looper.getMainLooper())


    /** ShellBridge 通知授权用(plain Activity 无 androidx lambda API,自持回调)。
     * main.post:桥 dispatch 在 pool 线程直调,权限弹窗必须回主线程。 */
    fun requestPostNotifications(onResult: (Boolean) -> Unit) {
        permCallback = onResult
        main.post { requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFY) }
    }

    /** 相机统一闸:takePhoto(声明即须持)与扫码共用;拒绝走 onDenied。 */
    fun ensureCamera(onReady: () -> Unit, onDenied: () -> Unit) {
        if (checkSelfPermission(android.Manifest.permission.CAMERA) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            onReady()
            return
        }
        cameraReady = onReady
        cameraDenied = onDenied
        requestPermissions(arrayOf(android.Manifest.permission.CAMERA), REQ_CAMERA)
    }

    private var cameraReady: (() -> Unit)? = null
    private var cameraDenied: (() -> Unit)? = null

    /** 拍照:原图经 FileProvider 写 cacheDir(take_photo.jpg,用后即删)。 */
    fun startTakePhoto(file: File) {
        val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(MediaStore.EXTRA_OUTPUT, uri)
            /* clipData 让授权随帧传播(部分相机 app 不读 EXTRA_OUTPUT 的 grant) */
            clipData = ClipData.newRawUri("output", uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        }
        try {
            startActivityForResult(intent, ShellBridge.REQ_SHOT)
        } catch (e: android.content.ActivityNotFoundException) {
            /* 无相机 app 接收(精简 ROM/专用设备):不崩进程;走 REQ_SHOT 取消
             * 路径回灌 —— 桥侧除账,JS 收失败回执而非「拍照已在进行中」卡死。 */
            ShellLog.write("camera app missing: ${e.message}")
            onActivityResult(ShellBridge.REQ_SHOT, RESULT_CANCELED, null)
        }
    }

    /** 配对扫码:zxing-android-embedded 自含 CaptureActivity(相机+取景 UI)。 */
    fun startQrScan() {
        IntentIntegrator(this)
            .setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
            .setPrompt("将桌面端配对二维码对准取景框")
            .setBeepEnabled(false)
            .setOrientationLocked(false)
            .initiateScan()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        val granted = grantResults.getOrElse(0) { -1 } == 0
        when (requestCode) {
            /* 各分支自清自的回调:REQ_CAMERA 先回时误清通知回调会让 notify 应答永挂 */
            REQ_NOTIFY -> {
                permCallback?.invoke(granted)
                permCallback = null
            }
            REQ_CAMERA -> {
                val ok = cameraReady
                val no = cameraDenied
                cameraReady = null
                cameraDenied = null
                if (granted) ok?.invoke() else no?.invoke()
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            ShellBridge.REQ_PICK -> bridge.onPickResult(resultCode == RESULT_OK, data?.data)
            ShellBridge.REQ_SHOT -> bridge.onShotResult(resultCode == RESULT_OK)
            IntentIntegrator.REQUEST_CODE -> {
                val res = IntentIntegrator.parseActivityResult(requestCode, resultCode, data)
                bridge.onQrResult(res?.contents)
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ShellLog.init(this)
        PinnedTls.init(this)
        ShellLog.write("== launch")

        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/", DistAssetsHandler(this))
            .build()

        webView = WebView(this)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.allowFileAccess = false
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? {
                /* 子帧/子资源加载闸(iOS isMainFrame 闸同语义):addJavascriptInterface
                 * 对页面所有帧可见是平台特性,只能从加载面断 —— 外域 iframe 拿不到
                 * 桥面(creds/http);主帧外域导航已由 shouldOverrideUrlLoading 拦。 */
                if (request.url.host != "appassets.androidplatform.net") {
                    ShellLog.write("res FAIL ${request.url}")
                    return WebResourceResponse(
                        "text/plain", null,
                        java.io.ByteArrayInputStream(ByteArray(0)),
                    )
                }
                return assetLoader.shouldInterceptRequest(request.url)
            }

            /// 导航闸(对齐 iOS NavLog):壳内容是自有静态包,主帧没有合法理由跳外部。
            /// 放行外部导航 = 任意网页拿到壳桥(creds/http)——钉住体系被一次跳转旁路。
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                val host = request.url.host ?: return true
                if (host == "appassets.androidplatform.net") return false
                ShellLog.write("nav FAIL $request.url")
                return true
            }
        }

        /* 壳标识与设备名必须先于模块求值:gate 按 isMobileShell() 分流;设备名
         * (MANUFACTURER MODEL,如 "Google Pixel 9")供配对上报与重连拨号 &name=
         * 参数 —— iOS utsname 拼名同律,多机在桌面设备表可区分(引号/反斜杠转义)。 */
        val deviceName = "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}"
            .replace("\\", "\\\\").replace("\"", "\\\"").replace("'", "\\'")
        WebViewCompat.addDocumentStartJavaScript(
            webView,
            "window.__TMD_SHELL__ = 'mobile'; window.__TMD_DEVICE_NAME__ = \"$deviceName\";",
            setOf("https://appassets.androidplatform.net"),
        )
        bridge = ShellBridge(this)
        webView.addJavascriptInterface(bridge, "AndroidShell")
        bridge.attach(webView)
        WsTunnel.attach(webView)

        setContentView(webView)
        webView.loadUrl("https://appassets.androidplatform.net/index.html")
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onPause() {
        /* 暂停本 WebView 的布局/解析/JS 定时器(后台不空转;pauseTimers 是全局
         * API,影响其它 WebView,不用)。 */
        webView.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onDestroy() {
        WsTunnel.shutdown()
        WsTunnel.attach(null)
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        private const val REQ_NOTIFY = 7001
        private const val REQ_CAMERA = 7002
    }
}

/// dist 域根挂载:assets/dist/<path>;防目录穿越,MIME 按扩展名(对齐 iOS DistSchemeHandler)。
private class DistAssetsHandler(private val context: Context) : WebViewAssetLoader.PathHandler {
    private val mime = mapOf(
        "html" to "text/html", "js" to "text/javascript", "mjs" to "text/javascript",
        "css" to "text/css", "json" to "application/json", "svg" to "image/svg+xml",
        "png" to "image/png", "jpg" to "image/jpeg", "jpeg" to "image/jpeg",
        "webp" to "image/webp", "gif" to "image/gif", "ico" to "image/x-icon",
        "woff" to "font/woff", "woff2" to "font/woff2", "ttf" to "font/ttf",
        "map" to "application/json", "wasm" to "application/wasm",
    )

    override fun handle(path: String): WebResourceResponse? {
        val clean = path.removePrefix("/").ifEmpty { "index.html" }
        if (clean.contains("..")) {
            ShellLog.write("404 escape $path")
            return null
        }
        return try {
            val stream = context.assets.open("dist/$clean")
            val ext = clean.substringAfterLast('.', "").lowercase()
            ShellLog.write("200 $clean")
            WebResourceResponse(mime[ext] ?: "application/octet-stream", null, stream)
        } catch (e: Exception) {
            ShellLog.write("404 read $clean: ${e.message}")
            null
        }
    }
}
