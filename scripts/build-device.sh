#!/bin/bash
# tmd-cli 移动壳真机构建。
# 背景:上游 tauri-cli 的 xcode-script 阶段在 Xcode 27 下连自身守护进程失败即 panic
# (已知 bug 家族),故手动复刻其流水线:cargo staticlib + SPM Debug Swift shim
# (SPM Debug 配置才导出 @_cdecl 全局符号,且 libTauri.a 已含 SwiftRs;勿再单独
# 合并 libSwiftRs,会引入重复类注册崩溃),libtool 合并成 libapp.a 后走 xcodebuild。
# 上游修复后本脚本可整体删除。
#
# 用法:scripts/build-device.sh
# 前置:mobile-app 已 pnpm install;rustup target aarch64-apple-ios 已装。
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
GEN=mobile-app/src-tauri/gen/apple

# 1. 前端产物(资产经 custom-protocol 嵌入 Rust 二进制)
pnpm build > /dev/null
rm -rf mobile-app/dist && cp -R dist mobile-app/dist

# 2. Rust 静态库
(cd mobile-app/src-tauri && cargo build --release --target aarch64-apple-ios --lib --features tauri/custom-protocol)

# 3. Tauri Swift shim(SPM Debug;与 Cargo.lock 的 tauri 版本一致,ABI 才匹配)
TAURI_API=$(dirname "$(find ~/.cargo/registry/src/*/tauri-2.11.6/mobile/ios-api/Package.swift | head -1)")
SHIM=/tmp/tmd-swift-shim-ios
if [ ! -d "$SHIM" ]; then
  cp -R "$TAURI_API" "$SHIM" && chmod -R u+w "$SHIM"
  (cd "$SHIM" && swift package resolve > /dev/null 2>&1)
fi
(cd "$SHIM" && SDKROOT=$(xcrun --sdk iphoneos --show-sdk-path) swift build -c debug --triple arm64-apple-ios --sdk "$SDKROOT")
SWIFT_LIB="$SHIM/.build/out/Products/Debug-iphoneos/libTauri.a"

# 4. 合并 libapp.a(cargo staticlib + Swift shim)
mkdir -p "$GEN/Externals/arm64/release" "$GEN/Externals/arm64/debug"
xcrun libtool -static -o "$GEN/Externals/arm64/release/libapp.a" \
  "mobile-app/src-tauri/target/aarch64-apple-ios/release/libtmd_mobile_lib.a" \
  "$SWIFT_LIB" 2> /dev/null
cp "$GEN/Externals/arm64/release/libapp.a" "$GEN/Externals/arm64/debug/libapp.a"
echo "[build-device] libapp.a 就绪"

# 5. xcodebuild(Rust 构建阶段已被 build-rust-stub.sh 短路;签名交给调用方参数)
(cd "$GEN" && xcodebuild -project tmd-mobile.xcodeproj -scheme tmd-mobile_iOS \
  -configuration Release -destination 'generic/platform=iOS' \
  -derivedDataPath /tmp/tmd-dev-build build "$@")
echo "[build-device] 真机产物: '/tmp/tmd-dev-build/Build/Products/debug-iphoneos/tmd-cli mobile.app'"
