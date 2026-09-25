package com.tmdcli.mobile

import android.annotation.SuppressLint
import android.content.Context
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat

/// 安卓壳入口 —— 对齐 iOS TmdApp/ShellView:
/// 资产挂载把 assets/dist 挂到 https://appassets.androidplatform.net 域根
/// (dist/index.html 用根绝对路径 /assets/...,挂域根才原样命中;https origin 下
/// localStorage 持久可靠)。addDocumentStartJavaScript 先于模块求值注入
/// window.__TMD_SHELL__='mobile'(等价 WKUserScript atDocumentStart)。
/// WS/自签 http 全部走原生隧道与钉住(ShellBridge/WsTunnel/PinnedTls)。
class MainActivity : android.app.Activity() {
    private lateinit var webView: WebView
    private var permCallback: ((Boolean) -> Unit)? = null

    /** ShellBridge 通知授权用(plain Activity 无 androidx lambda API,自持回调)。 */
    fun requestPostNotifications(onResult: (Boolean) -> Unit) {
        permCallback = onResult
        requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 7001)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 7001) permCallback?.invoke(grantResults.getOrElse(0) { -1 } == 0)
        permCallback = null
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
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

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

        /* 壳标识必须先于模块求值(gate 按 isMobileShell() 分流) */
        WebViewCompat.addDocumentStartJavaScript(
            webView,
            "window.__TMD_SHELL__ = 'mobile';",
            setOf("https://appassets.androidplatform.net"),
        )
        val bridge = ShellBridge(this)
        webView.addJavascriptInterface(bridge, "AndroidShell")
        bridge.attach(webView)
        WsTunnel.attach(webView)

        setContentView(webView)
        webView.loadUrl("https://appassets.androidplatform.net/index.html")
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        WsTunnel.attach(null)
        super.onDestroy()
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
