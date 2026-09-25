package com.tmdcli.mobile

import android.content.Context
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.Base64
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager
import okhttp3.OkHttpClient

/// 证书钉住(对齐 iOS PinnedTLS / 桌面 pinned_tls.rs):
/// 比对**叶证书 DER 的 SHA-256(base64)**;三级来源:
///   1. 内置主机(deploy/relay/relay-cert.der,随包打进 res/raw);
///   2. 钥匙串 creds 的 pinHost/pin(一键部署动态钉);
///   3. 一次性 pin(配对 offer 携带,TOFU,此时钥匙串还没有 creds)。
/// pin 不匹配一律抛 CertificateException → 请求失败(静默走拒绝分支,与 iOS 同)。
object PinnedTls {
    const val BUILTIN_HOST = "123.249.45.144"
    private var builtinSha256B64: String? = null

    fun init(context: Context) {
        try {
            context.resources.openRawResource(R.raw.relay_cert).use { input ->
                builtinSha256B64 = sha256Base64(input.readBytes())
            }
            ShellLog.write("pinned: builtin cert loaded")
        } catch (e: Exception) {
            ShellLog.write("pinned: builtin cert load fail " + e.message)
        }
    }

    fun sha256Base64(der: ByteArray): String =
        Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(der))

    private fun builtinMatches(host: String): Boolean =
        host == BUILTIN_HOST && builtinSha256B64 != null

    /// 一次性信任管理器:每次请求现场构造(内置 pin + creds pin + 一次性 pin 三来源)。
    private class PinnedTrustManager(
        private val host: String,
        private val extraPin: String?,
        private val credsPin: String?,
        private val builtinB64: String?,
    ) : X509TrustManager {
        private fun accept(leafDer: ByteArray) {
            val leafB64 = sha256Base64(leafDer)
            if (extraPin != null && extraPin == leafB64) return
            if (credsPin != null && credsPin == leafB64) return
            if (builtinB64 != null && builtinB64 == leafB64) return
            throw CertificateException("pin mismatch")
        }

        override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}

        override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
            if (chain.isEmpty()) throw CertificateException("empty chain")
            accept(chain[0].encoded)
        }

        override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
    }

    /// 目标闸(与 ShellBridge.postTargetAllowed 同语义,供 http 与 ws 共用)。
    fun targetAllowed(scheme: String, host: String): Boolean {
        if (scheme == "https") return true
        if (scheme != "http") return false
        if (host == "localhost") return true
        val parts = host.split(".")
        if (parts.size != 4) return false
        val octets = ArrayList<Int>(4)
        for (p in parts) {
            /* 前导零(010.1.1.1 可被按八进制解出公网)/超 3 位/非数字一律拒 */
            if (p.length > 3 || (p.length > 1 && p[0] == '0')) return false
            val v = p.toIntOrNull() ?: return false
            octets.add(v)
        }
        val a = octets[0]; val b = octets[1]
        /* IPv6 字面量等非点分四段一律拒(与 Swift 版同;私网 v6 列入暂缓项) */
        return a == 127 || a == 10 || (a == 192 && b == 168) || (a == 172 && b in 16..31)
    }

    /// 构造钉住 OkHttp(WS 隧道与 http.post 共用);系统默认 TrustManager 兜系统 CA 证书,
    /// 钉住主机的自签证书由 PinnedTrustManager 放行,其余主机走正常校验。
    fun client(context: Context, host: String, oneShotPin: String?): OkHttpClient {
        val credsPin = try {
            val json = CredsStore.read(context) ?: return baseClient(PinnedTrustManager(host, oneShotPin, null, builtinSha256B64))
            val obj = org.json.JSONObject(json)
            val pinHost = obj.optString("pinHost", "")
            val pin = obj.optString("pin", "")
            if (pin.isNotEmpty() && pinHost == host) pin else null
        } catch (e: Exception) {
            ShellLog.write("pinned: creds read fail " + e.message)
            null
        }
        return baseClient(PinnedTrustManager(host, oneShotPin, credsPin, builtinSha256B64))
    }

    private fun baseClient(tm: X509TrustManager): OkHttpClient {
        val ssl = SSLContext.getInstance("TLS")
        ssl.init(null, arrayOf(tm), SecureRandom())
        return OkHttpClient.Builder()
            .sslSocketFactory(ssl.socketFactory, tm)
            .build()
    }
}
