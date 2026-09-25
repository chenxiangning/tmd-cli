#!/bin/bash
# tmd-cli 手机壳真机构建(安卓版:Kotlin + WebView 壳,mobile-app/android-shell)。
#
# 与 build-device.sh(iOS)同构:壳二进制与前端 dist 必须同包——dist 由本脚本
# 重新拷贝进 assets;只刷前端不重装壳 = 旧壳/新前端契约漂移(白屏类)。
#
# 用法:
#   scripts/build-device-android.sh             # 构建不安装
#   scripts/build-device-android.sh --install   # 构建并安装到当前连接的真机(adb)
#
# 前置:pnpm build 可用;ANDROID_HOME(或 ~/Library/Android/sdk)含 platform 35;
# JDK 17。
set -euo pipefail
cd "$(dirname "$0")/.."
APP_ID=com.tmdcli.mobile
SHELL_DIR=mobile-app/android-shell

echo "[build-android] 1/3 前端 dist"
pnpm build > /dev/null
rm -rf "$SHELL_DIR/app/src/main/assets/dist"
mkdir -p "$SHELL_DIR/app/src/main/assets"
cp -R dist "$SHELL_DIR/app/src/main/assets/dist"

echo "[build-android] 2/3 gradle assembleDebug"
cd "$SHELL_DIR"
if [[ -z "${ANDROID_HOME:-}" && -d "$HOME/Library/Android/sdk" ]]; then
  export ANDROID_HOME="$HOME/Library/Android/sdk"
fi
if command -v ./gradlew > /dev/null 2>&1; then GRADLE=./gradlew; else GRADLE=gradle; fi
"$GRADLE" assembleDebug --console=plain -q

APK="$PWD/app/build/outputs/apk/debug/app-debug.apk"
echo "[build-android] 产物: $APK"
cd ../..

if [[ "${1:-}" == "--install" ]]; then
  echo "[build-android] 3/3 安装并启动(adb 连接的真机/模拟器)"
  adb install -r "$APK"
  adb shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 > /dev/null
fi
