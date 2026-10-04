package com.tmdcli.mobile

import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
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
            /* java.net.URL 不认 ws/wss 协议(真机实锤:unknown protocol → 全部建连
             * 即炸,配对后永远连不上);OkHttp 本身认,此处仅为提取 host/port 的解析,
             * 协议改写成 http/https 再解。 */
            val url = java.net.URL(urlStr.replaceFirst(Regex("^ws"), "http"))
            val scheme = url.protocol
            if (!PinnedTls.targetAllowed(scheme, url.host)) {
                ShellLog.write("ws dial reject id=$id host=${url.host}")
                emit(id, "close", "{\"code\":1006,\"reason\":\"target not allowed\"}")
                return
            }
            /* 心跳保活(对齐 iOS WsTunnel 15s sendPing,2026-10-03 同日缺口):手机网
             * NAT 30~60s 静默回收空闲 TCP,readyState 仍 OPEN 的假活线要到下次 invoke
             * 才暴露(真机实证「图片发送第一次失败,重试即成功」)。15s 协议 ping 让
             * NAT 映射不过期;pong 未回(死线)OkHttp 自动拆线 → onFailure → close
             * 事件 → JS 桥退避重拨,自愈先于用户操作。
             * ponytail: OkHttp 死线不可像 iOS 那样按在途发送顺延——单帧冲刷 >15s
             * 的极慢上行会被误拆(挂图已端内压缩至 ~0.3-0.7MB,1Mbps 上行 ~6s 安
             * 全);复发时改自管 ping 线程(iOS inflightSendsById 同款)。 */
            val client: OkHttpClient = PinnedTls.client(context, url.host, null)
                .newBuilder().pingInterval(15, TimeUnit.SECONDS).build()
            val req = Request.Builder().url(urlStr).build()
            /* 单连接不变量(对齐 iOS 2026-10-03 S3):JS 桥同一时刻只持一条 ws;
             * 页面 reload 后旧线 JS 侧无人收线会永生,开新线一律拆旧,防孤儿 socket
             * 与幽灵事件回注到换代后的页面。 */
            if (sockets.isNotEmpty()) {
                val stale = sockets.keys.toList()
                for (k in stale) {
                    opened.remove(k)
                    sockets.remove(k)?.cancel()
                }
                ShellLog.write("ws open id=$id: evicted ${stale.size} stale conn(s)")
            }
            opened.remove(id)
            /* 身份闸(对齐 iOS tasks[id] === task):回调只认 sockets 里**当前**这条线。
             * 拆线/换代后旧 socket 的迟到回调(cancel 触发的 onFailure、在途 message)
             * 不得触碰新线——按 id 操作会让旧 onFailure 误删新 socket 并注幽灵 close,
             * 换代后页面 reload 重置 nextConn 从 1 重来,新旧同 id 是常态不是边角。 */
            val ws = client.newWebSocket(req, object : WebSocketListener() {
                override fun onOpen(web: WebSocket, response: Response) {
                    if (sockets[id] === web && opened.add(id)) emit(id, "open", "{}")
                }

                override fun onMessage(web: WebSocket, text: String) {
                    if (sockets[id] !== web) return
                    emit(id, "message", "{\"data\":${org.json.JSONObject.quote(text)}}")
                }

                override fun onMessage(web: WebSocket, bytes: ByteString) {
                    if (sockets[id] !== web) return
                    val b64 = Base64.getEncoder().encodeToString(bytes.toByteArray())
                    emit(id, "message", "{\"b64\":\"$b64\"}")
                }

                override fun onClosed(web: WebSocket, code: Int, reason: String) {
                    if (!sockets.remove(id, web)) return
                    opened.remove(id)
                    emit(id, "close", "{\"code\":$code,\"reason\":${org.json.JSONObject.quote(reason)}}")
                }

                override fun onFailure(web: WebSocket, t: Throwable, response: Response?) {
                    /* remove(key, value) 原子身份除账:仅当本线仍在位才回注 close;
                     * JS 主动 close()/换代拆线后的迟到失败静默(JS 已本地 CLOSED) */
                    if (!sockets.remove(id, web)) return
                    opened.remove(id)
                    ShellLog.write("ws close id=$id: $t")
                    emit(id, "close", "{\"code\":1006,\"reason\":${org.json.JSONObject.quote(t.message ?: "failure")}}")
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
