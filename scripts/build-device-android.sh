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

echo "[build-android] 2/3 gradle assembleRelease(仓内自签 keystore,与 CI 产物同签名)"
cd "$SHELL_DIR"
# SDK 定位:环境变量 > ~/Library/Android/sdk(Android Studio)> brew cask 命令行工具;
# 都没有则看 local.properties(sdk.dir,gitignore,开发者手配)。
if [[ -z "${ANDROID_HOME:-}" && ! -f local.properties ]]; then
  if [[ -d "$HOME/Library/Android/sdk" ]]; then
    export ANDROID_HOME="$HOME/Library/Android/sdk"
  elif [[ -d /opt/homebrew/share/android-commandlinetools ]]; then
    export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
  fi
fi
if [[ -x ./gradlew ]]; then GRADLE=./gradlew; else GRADLE=gradle; fi  # 缺执行位让 gradle 报错暴露,勿静默回落
"$GRADLE" assembleRelease --console=plain -q

APK="$PWD/app/build/outputs/apk/release/app-release.apk"
echo "[build-android] 产物: $APK"
cd ../..

if [[ "${1:-}" == "--install" ]]; then
  echo "[build-android] 3/3 安装并启动(adb 连接的真机/模拟器)"
  adb install -r "$APK"
  adb shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 > /dev/null
fi
