package com.tmdcli.mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.util.concurrent.Executors
import okhttp3.MediaType.Companion.toMediaType
import org.json.JSONObject

/// 壳能力桥 —— 前端 kernel/shellBridge.ts 的 Android 对端。
/// 帧协议:AndroidShell.post(JSON 串 {id, method, args}) → 分发 →
/// evaluateJavascript 调 window.__TMD_SHELL_RESULT__(id, ok, payload) 回注。
/// 能力:notify(本地通知)/ log / creds.get/set/delete / ws.open/send/close / http.post / screen.orient。
/// 这些是手机本机能力,不经桌面桥、不进 AppDevice 白名单。
class ShellBridge(private val activity: MainActivity) {
    private val main = Handler(Looper.getMainLooper())
    private val pool = Executors.newSingleThreadExecutor()
    private var webview: WebView? = null

    fun attach(view: WebView?) {
        main.post { webview = view }
    }

    /// addJavascriptInterface 只支持原语参数:整个信封 JSON 串进出。
    @android.webkit.JavascriptInterface
    fun post(json: String) {
        pool.execute {
            try {
                val envelope = JSONObject(json)
                val id = envelope.optInt("id", 0)
                val method = envelope.optString("method", "")
                val args = envelope.optJSONObject("args") ?: JSONObject()
                dispatch(id, method, args)
            } catch (e: Exception) {
                ShellLog.write("bridge post parse fail: $e")
            }
        }
    }

    private fun dispatch(id: Int, method: String, args: JSONObject) {
        when (method) {
            "notify" -> notify(id, args)
            "log" -> ShellLog.write(args.optString("line", ""))
            "creds.get" -> reply(id, true, CredsStore.read(activity))
            "creds.set" -> {
                val json = args.optString("json", "")
                if (json.isEmpty()) reply(id, false, "missing json")
                else reply(id, CredsStore.write(activity, json), null)
            }
            "creds.delete" -> {
                CredsStore.delete(activity)
                reply(id, true, null)
            }
            "ws.open" -> {
                val cid = args.optInt("id", 0)
                val url = args.optString("url", "")
                if (cid != 0 && url.isNotEmpty()) WsTunnel.open(activity, cid, url)
                else reply(id, false, "ws.open: bad args")
            }
            "ws.send" -> WsTunnel.send(args.optInt("id", 0), args.optString("data", ""))
            "ws.close" -> WsTunnel.close(args.optInt("id", 0))
            "http.post" -> httpPost(id, args)
            "screen.orient" -> {
                val mode = args.optString("mode", "portrait")
                main.post {
                    activity.requestedOrientation = if (mode == "landscape")
                        android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                    else android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                    reply(id, true, null)
                }
            }
            else -> reply(id, false, "unknown method $method")
        }
    }

    /// 壳原生 POST(自签中继 /pair:WebView fetch 过不了自签校验,下沉 PinnedTls)。
    private fun httpPost(id: Int, args: JSONObject) {
        val urlStr = args.optString("url", "")
        val body = args.optString("body", "")
        val pin = if (args.isNull("pin")) null else args.optString("pin", null)
        val scheme = if (urlStr.startsWith("https")) "https" else "http"
        val host = try { java.net.URL(urlStr).host } catch (_: Exception) { "" }
        if (urlStr.isEmpty() || !PinnedTls.targetAllowed(scheme, host)) {
            reply(id, false, "http.post: bad args")
            return
        }
        ShellLog.write("http.post dial url=$urlStr pin=${pin != null}")
        try {
            val client = PinnedTls.client(activity, host, pin)
            val payload = body.toByteArray(Charsets.UTF_8)
            val req = okhttp3.Request.Builder()
                .url(urlStr)
                .post(okhttp3.RequestBody.create("application/json".toMediaType(), payload))
                .build()
            client.newCall(req).enqueue(object : okhttp3.Callback {
                override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
                    val text = try { response.body?.string() ?: "" } catch (_: Exception) { "" }
                    val status = response.code
                    response.close()
                    reply(id, true, JSONObject().put("status", status).put("body", text))
                }

                override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                    ShellLog.write("http.post fail: $e")
                    reply(id, false, e.message ?: "http fail")
                }
            })
        } catch (e: Exception) {
            reply(id, false, e.message ?: "http fail")
        }
    }

    /// 权限未决/被拒 → 静默成功(对齐 iOS 降级语义;应用内横幅照旧)。
    private fun notify(id: Int, args: JSONObject) {
        val title = args.optString("title", "tmd-cli")
        val body = args.optString("body", "")
        val granted = if (Build.VERSION.SDK_INT >= 33)
            ContextCompat.checkSelfPermission(activity, android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        else true
        if (!granted && Build.VERSION.SDK_INT >= 33) {
            activity.requestPostNotifications { ok -> if (ok) postNotification(title, body, id) else reply(id, true, "denied") }
            return
        }
        postNotification(title, body, id)
    }

    private fun postNotification(title: String, body: String, id: Int) {
        try {
            val manager = activity.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= 26) {
                manager.createNotificationChannel(NotificationChannel("tmd", "tmd-cli", NotificationManager.IMPORTANCE_DEFAULT))
            }
            val builder = if (Build.VERSION.SDK_INT >= 26) {
                NotificationCompat.Builder(activity, "tmd")
            } else {
                @Suppress("DEPRECATION")
                NotificationCompat.Builder(activity, "")
            }
            manager.notify(1, builder.setContentTitle(title).setContentText(body).setSmallIcon(android.R.drawable.sym_def_app_icon).build())
            reply(id, true, null)
        } catch (e: Exception) {
            ShellLog.write("notify fail: $e")
            reply(id, true, null)
        }
    }

    /// 回注:主线程 evaluateJavascript;payload 经 {"p":…} 包裹避免字符串双重转义(与 iOS 同)。
    private fun reply(id: Int, ok: Boolean, payload: Any?) {
        main.post {
            val json = if (payload != null) JSONObject().put("p", payload).toString() else "{\"p\":null}"
            val js = "window.__TMD_SHELL_RESULT__ && window.__TMD_SHELL_RESULT__($id, ${if (ok) "true" else "false"}, ($json)[\"p\"])"
            webview?.evaluateJavascript(js, null)
        }
    }
}
