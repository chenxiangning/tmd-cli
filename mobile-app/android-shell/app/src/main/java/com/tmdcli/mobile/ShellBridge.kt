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
import android.content.Intent
import android.net.Uri
import java.io.File

/// 壳能力桥 —— 前端 kernel/shellBridge.ts 的 Android 对端。
/// 帧协议:AndroidShell.post(JSON 串 {id, method, args}) → 分发 →
/// evaluateJavascript 调 window.__TMD_SHELL_RESULT__(id, ok, payload) 回注。
/// 能力:notify(本地通知)/ log / creds.get/set/delete / ws.open/send/close /
/// http.post / screen.orient / pickImage / takePhoto / qr.start(与 iOS ShellBridge 对齐)。
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
            "pickImage" -> pickImage(id)
            "takePhoto" -> takePhoto(id)
            "qr.start" -> qrStart()
            else -> reply(id, false, "unknown method $method")
        }
    }

    // ---------- 选图 / 拍照(对齐 iOS pickImage/takePhoto;回传 {b64}/{cancelled}) ----------
    /* 在途请求号:二次进入(双击/异步权限窗)时回「已在进行中」,防首个
     * JS promise 永挂。状态一律只在主线程读写(与 iOS onMain 纪律同)。 */
    private var pickReqId = 0
    private var shotReqId = 0
    private var shotFile: File? = null
    private var qrInFlight = false

    /// 选图:ACTION_GET_CONTENT(系统选择器,全版本免权限);
    /// native 限边 2048 转 JPEG(WebView 侧不再解大图/EXIF)。
    private fun pickImage(id: Int) {
        main.post {
            if (pickReqId != 0) { reply(id, false, "选图已在进行中"); return@post }
            pickReqId = id
            val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "image/*"
            }
            activity.startActivityForResult(intent, REQ_PICK)
        }
    }

    /// 拍照:ACTION_IMAGE_CAPTURE 原图落 cacheDir(FileProvider URI);
    /// 壳声明了 CAMERA → 发 intent 前必须持运行时授权(拒绝回错,与 iOS 同文案)。
    private fun takePhoto(id: Int) {
        main.post {
            if (shotReqId != 0) { reply(id, false, "拍照已在进行中"); return@post }
            shotReqId = id
            activity.ensureCamera(
                onReady = {
                    val f = ImageShot.tempShotFile(activity)
                    shotFile = f
                    activity.startTakePhoto(f)
                },
                onDenied = {
                    shotReqId = 0
                    reply(id, false, "相机权限被拒,请在系统设置开启")
                },
            )
        }
    }

    /// 配对扫码(iOS QrBridge 的对端):无应答帧,结果经 window.__TMD_QR__(text|null)。
    /// 拒相机权限 = 取消(iOS 同语义 deliver(nil))。
    private fun qrStart() {
        main.post {
            if (qrInFlight) return@post
            qrInFlight = true
            activity.ensureCamera(
                onReady = { activity.startQrScan() },
                onDenied = { qrInFlight = false; emitQr(null) },
            )
        }
    }

    /// Activity 结果回灌(REQ_PICK);解码在 pool,回注在主线程。
    fun onPickResult(ok: Boolean, uri: Uri?) {
        main.post {
            val id = pickReqId
            pickReqId = 0
            if (id == 0) return@post
            if (!ok || uri == null) { reply(id, true, JSONObject().put("cancelled", true)); return@post }
            pool.execute {
                val b64 = try { ImageShot.decodeB64(activity, uri) } catch (e: Exception) { null }
                if (b64 != null) reply(id, true, JSONObject().put("b64", b64))
                else { ShellLog.write("pick decode fail uri=$uri"); reply(id, false, "选图失败:无法解码") }
            }
        }
    }

    /// Activity 结果回灌(REQ_SHOT);原图用后即删。
    fun onShotResult(ok: Boolean) {
        main.post {
            val id = shotReqId
            shotReqId = 0
            val f = shotFile
            shotFile = null
            if (id == 0) { f?.delete(); return@post }
            if (!ok) { reply(id, true, JSONObject().put("cancelled", true)); f?.delete(); return@post }
            pool.execute {
                val b64 = try { ImageShot.decodeB64(activity, Uri.fromFile(f)) } catch (e: Exception) { null }
                f?.delete()
                if (b64 != null) reply(id, true, JSONObject().put("b64", b64))
                else { ShellLog.write("shot decode fail"); reply(id, false, "拍照失败:无法解码") }
            }
        }
    }

    /// Activity 结果回灌(REQ_QR):扫码文本或取消。
    fun onQrResult(text: String?) {
        main.post {
            if (!qrInFlight) return@post
            qrInFlight = false
            emitQr(text)
        }
    }

    private fun emitQr(text: String?) {
        val arg = if (text != null) JSONObject.quote(text) else "null"
        webview?.evaluateJavascript("window.__TMD_QR__ && window.__TMD_QR__($arg)", null)
    }

    companion object {
        const val REQ_PICK = 7003
        const val REQ_SHOT = 7004
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
                /* HIGH = 横幅 + 声音(对齐 iOS 前台 willPresent banner+sound 语义);
                 * 旧装机的 DEFAULT 通道不会再升档(channel importance 不可改),侧载升级属可接受。 */
                manager.createNotificationChannel(NotificationChannel("tmd", "tmd-cli", NotificationManager.IMPORTANCE_HIGH))
            }
            val builder = if (Build.VERSION.SDK_INT >= 26) {
                NotificationCompat.Builder(activity, "tmd")
            } else {
                @Suppress("DEPRECATION")
                NotificationCompat.Builder(activity, "")
            }
            /* 点通知拉起壳(iOS 系统默认行为);autoCancel 点后撤横幅。 */
            val tap = android.app.PendingIntent.getActivity(
                activity, 0,
                android.content.Intent(activity, MainActivity::class.java),
                android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT,
            )
            /* 通知 id 递增:多条 ask 通知各自成横幅(iOS UUID id 同语义),不互相覆盖。 */
            notifySeq += 1
            manager.notify(notifySeq, builder.setContentTitle(title).setContentText(body)
                .setSmallIcon(android.R.drawable.sym_def_app_icon)
                .setContentIntent(tap).setAutoCancel(true).build())
            reply(id, true, null)
        } catch (e: Exception) {
            ShellLog.write("notify fail: $e")
            reply(id, true, null)
        }
    }

    private var notifySeq = 0

    /// 回注:主线程 evaluateJavascript;payload 经 {"p":…} 包裹避免字符串双重转义(与 iOS 同)。
    private fun reply(id: Int, ok: Boolean, payload: Any?) {
        main.post {
            val json = if (payload != null) JSONObject().put("p", payload).toString() else "{\"p\":null}"
            val js = "window.__TMD_SHELL_RESULT__ && window.__TMD_SHELL_RESULT__($id, ${if (ok) "true" else "false"}, ($json)[\"p\"])"
            webview?.evaluateJavascript(js, null)
        }
    }
}
