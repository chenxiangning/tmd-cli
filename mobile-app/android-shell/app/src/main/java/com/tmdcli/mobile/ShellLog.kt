package com.tmdcli.mobile

import android.content.Context
import java.io.File

/// 页面诊断日志:写应用私有目录 shell.log(对齐 iOS Documents/shell.log;
/// adb run-as / Android Studio Device Explorer 可拉取排查)。
object ShellLog {
    private var dir: File? = null

    fun init(context: Context) {
        dir = context.filesDir
    }

    fun write(line: String) {
        try {
            File(dir, "shell.log").appendText("[" + System.currentTimeMillis() + "] " + line + "\n")
        } catch (_: Exception) {
            /* 日志写失败静默:诊断通道不可反噬主流程 */
        }
    }
}
