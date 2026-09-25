package com.tmdcli.mobile

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/// 凭证存储:Android 加密偏好(对齐 iOS 钥匙串语义:设备绑定,单键存 JSON 串)。
/// 键名与前端迁移逻辑约定一致:tmd.mobile.creds.v1(kernel/mobile creds.ts)。
object CredsStore {
    private const val FILE = "tmd_creds"
    private const val KEY = "tmd.mobile.creds.v1"

    private fun prefs(context: Context): SharedPreferences {
        return try {
            val master = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
            EncryptedSharedPreferences.create(context, FILE, master,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
        } catch (e: Exception) {
            /* 加密库初始化失败(罕见,Keystore 异常):回落明文偏好并留痕,
             * 「删不掉凭证」比「凭证降级存储」更难排查 */
            ShellLog.write("creds: encrypted prefs init fail, fallback plain: " + e.message)
            context.getSharedPreferences(FILE + "_plain", Context.MODE_PRIVATE)
        }
    }

    fun read(context: Context): String? = prefs(context).getString(KEY, null)

    fun write(context: Context, json: String): Boolean =
        prefs(context).edit().putString(KEY, json).commit()

    fun delete(context: Context) {
        val ok = prefs(context).edit().remove(KEY).commit()
        ShellLog.write("creds delete ok=" + ok)
    }
}
