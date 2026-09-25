#!/bin/bash
# tmd-cli 手机壳真机构建(原生 SwiftUI + WKWebView 壳,mobile-app/native-shell)。
#
# 背景:上游 tauri-cli 的 iOS 流水线在 Xcode 27 下 xcode-script 阶段必 panic,
# 本壳弃用 gen/apple(2026-09-22 定),本脚本只编原生壳工程。
# 铁律:壳二进制与前端 dist 必须同包——dist 由本脚本从 repo dist 重新拷贝;
# 只刷前端不重装壳 = 旧壳/新前端契约漂移(白屏类,2026-09-23 实证)。
#
# 用法:
#   scripts/build-device.sh             # 构建不安装
#   scripts/build-device.sh --install   # 构建并安装到当前连接的真机(自动签名)
#
# 前置:pnpm build 可用;Xcode 已登录签名账号(团队 M8Y933SMW6)。
set -euo pipefail
cd "$(dirname "$0")/.."
TEAM=M8Y933SMW6
APP_ID=com.tmdcli.mobile
DERIVED=/tmp/tmd-native-build

echo "[build-device] 1/3 前端 dist"
pnpm build > /dev/null
rm -rf mobile-app/dist && cp -R dist mobile-app/dist

echo "[build-device] 2/3 xcodebuild(真机 Release,自动签名)"
(cd mobile-app/native-shell && xcodebuild \
  -project tmd-native-shell.xcodeproj \
  -scheme 'tmd-cli mobile' \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$DERIVED" \
  CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM="$TEAM" \
  -allowProvisioningUpdates build)

APP="$DERIVED/Build/Products/Release-iphoneos/tmd-cli mobile.app"
echo "[build-device] 产物: $APP"

if [[ "${1:-}" == "--install" ]]; then
  echo "[build-device] 3/3 安装并启动(第一台已连接真机;TMD_DEVICE_UDID 可指定)"
  DEV="${TMD_DEVICE_UDID:-$(xcrun devicectl list devices 2>/dev/null | grep -E 'connected' | grep -v simulated | grep -oE '[0-9A-F]{8}-[0-9A-F]{10,24}' | head -1 || true)}"
  if [[ -z "$DEV" ]]; then
    echo "[build-device] 未发现已连接真机;可用 TMD_DEVICE_UDID 指定" >&2
    exit 1
  fi
  xcrun devicectl device install app --device "$DEV" "$APP"
  xcrun devicectl device process launch --device "$DEV" "$APP_ID"
fi
