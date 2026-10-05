package com.tmdcli.mobile

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream

/// 图像回传收口(对齐 iOS pickImage/takePhoto 壳侧处理):
/// 原图(超大/EXIF 竖拍旋转)统一在 native 解码 → 限边 2048 → JPEG(85) → base64,
/// 回传形状 {b64}(与 iOS 同构,前端 pickResultToBlob 分流)。
/// HEIC 无需特判:API 26+ BitmapFactory 原生解码(minSdk 29)。
object ImageShot {
    private const val MAX_EDGE = 2048

    /// 解码 + 旋转 + 限边 + 压缩;失败返 null(坏 URI/解码失败,由调用方回错)。
    fun decodeB64(context: Context, uri: Uri): String? {
        val bmp = decodeRotated(context, uri) ?: return null
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 85, out)
        bmp.recycle()
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    /// 拍照原图落点(cacheDir 单文件,用后即删);file_paths.xml 的 cache-path 覆盖。
    fun tempShotFile(context: Context): File = File(context.cacheDir, "take_photo.jpg")

    private fun decodeRotated(context: Context, uri: Uri): Bitmap? {
        /* bounds 先行 → inSampleSize 粗降采样(2 的幂,防大图 OOM) */
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        open(context, uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_EDGE) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        var bmp = open(context, uri)?.use { BitmapFactory.decodeStream(it, null, opts) } ?: return null
        /* EXIF 竖拍:相册竖图/相机竖拍都带 orientation 标记,b64 进 <img> 不吃 EXIF */
        val deg = exifDegrees(context, uri)
        if (deg != 0f) {
            val rotated = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, Matrix().apply { postRotate(deg) }, true)
            if (rotated != bmp) bmp.recycle()
            bmp = rotated
        }
        /* 精确限边(降采样只保 ≥MAX_EDGE 边界,仍超时二次缩放) */
        val edge = maxOf(bmp.width, bmp.height)
        if (edge > MAX_EDGE) {
            val scale = MAX_EDGE.toFloat() / edge
            val scaled = Bitmap.createScaledBitmap(
                bmp, (bmp.width * scale).toInt().coerceAtLeast(1), (bmp.height * scale).toInt().coerceAtLeast(1), true,
            )
            if (scaled != bmp) bmp.recycle()
            bmp = scaled
        }
        return bmp
    }

    private fun open(context: Context, uri: Uri): InputStream? = try {
        context.contentResolver.openInputStream(uri)
    } catch (_: Exception) {
        null
    }

    private fun exifDegrees(context: Context, uri: Uri): Float {
        /* content://(SAF/FileProvider)与 file:// 都走 openInputStream;无 EXIF 头按 0 */
        val ori = try {
            open(context, uri)?.use {
                ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
            } ?: ExifInterface.ORIENTATION_NORMAL
        } catch (_: Exception) {
            ExifInterface.ORIENTATION_NORMAL
        }
        return when (ori) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> 0f
        }
    }
}
