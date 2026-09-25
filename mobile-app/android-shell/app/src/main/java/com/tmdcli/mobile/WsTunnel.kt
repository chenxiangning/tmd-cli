package com.tmdcli.mobile

import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString

/// 壳 WS 隧道:对齐 iOS WsTunnel——页面(https origin)到自签中继/局域网 ws:// 的
/// 连接全部下沉原生 OkHttp(证书钉住),帧回注 window.__TMD_SHELL_WS__(connId, event, payload)。
/// 对端是 kernel/shellWs.ts。连接号由 JS 侧分配(args.id),与请求信封 id 两套不混。
object WsTunnel {
    private val main = Handler(Looper.getMainLooper())
    private var webview: WebView? = null
    private val sockets = ConcurrentHashMap<Int, WebSocket>()
    private val opened = ConcurrentHashMap.newKeySet<Int>()

    fun attach(view: WebView?) {
        main.post { webview = view }
    }

    private fun emit(id: Int, event: String, payload: String) {
        main.post {
            val js = "window.__TMD_SHELL_WS__ && window.__TMD_SHELL_WS__($id, \"$event\", $payload)"
            webview?.evaluateJavascript(js, null)
        }
    }

    fun open(context: android.content.Context, id: Int, urlStr: String) {
        try {
            val url = java.net.URL(urlStr)
            val scheme = if (url.protocol == "wss") "https" else "http"
            if (!PinnedTls.targetAllowed(scheme, url.host)) {
                ShellLog.write("ws dial reject id=$id host=${url.host}")
                emit(id, "close", "{\"code\":1006,\"reason\":\"target not allowed\"}")
                return
            }
            val client = PinnedTls.client(context, url.host, null)
            val req = Request.Builder().url(urlStr).build()
            opened.remove(id)
            sockets[id]?.cancel()
            val ws = client.newWebSocket(req, object : WebSocketListener() {
                override fun onOpen(web: WebSocket, response: Response) {
                    if (opened.add(id)) emit(id, "open", "{}")
                }

                override fun onMessage(web: WebSocket, text: String) {
                    emit(id, "message", "{\"data\":${org.json.JSONObject.quote(text)}}")
                }

                override fun onMessage(web: WebSocket, bytes: ByteString) {
                    val b64 = Base64.getEncoder().encodeToString(bytes.toByteArray())
                    emit(id, "message", "{\"b64\":\"$b64\"}")
                }

                override fun onClosed(web: WebSocket, code: Int, reason: String) {
                    sockets.remove(id)
                    emit(id, "close", "{\"code\":$code,\"reason\":${org.json.JSONObject.quote(reason)}}")
                }

                override fun onFailure(web: WebSocket, t: Throwable, response: Response?) {
                    if (sockets.remove(id) != null || opened.remove(id)) {
                        ShellLog.write("ws close id=$id: $t")
                        emit(id, "close", "{\"code\":1006,\"reason\":${org.json.JSONObject.quote(t.message ?: "failure")}}")
                    }
                }
            })
            sockets[id] = ws
            ShellLog.write("ws dial id=$id host=${url.host} port=${if (url.port == -1) 0 else url.port}")
        } catch (e: Exception) {
            ShellLog.write("ws dial fail id=$id: $e")
            emit(id, "close", "{\"code\":1006,\"reason\":${org.json.JSONObject.quote(e.message ?: "dial error")}}")
        }
    }

    fun send(id: Int, text: String) {
        sockets[id]?.send(text)
    }

    fun close(id: Int) {
        opened.remove(id)
        sockets.remove(id)?.close(1000, null)
    }
}
