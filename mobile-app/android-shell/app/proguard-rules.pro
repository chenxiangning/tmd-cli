# R8 收缩补充规则(proguard-android-optimize.txt 已覆盖 @JavascriptInterface)。

# JS 经 AndroidShell 信封调用,类与方法名按注解保留;构造器随之保留。
-keepclassmembers class com.tmdcli.mobile.ShellBridge {
    @android.webkit.JavascriptInterface <methods>;
}

# WebView 回调(WebViewClient/WebChromeInterface)由 manifest/AAPT keep 兜底;
# okhttp 与 security-crypto 自带 consumer rules,无需重复声明。
