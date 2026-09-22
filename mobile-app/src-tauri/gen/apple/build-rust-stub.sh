#!/bin/bash
# 上游 tauri-cli 的 xcode-script 阶段在 Xcode 27 下连守护进程失败即 panic(已知 bug 家族)。
# 本地绕过:libapp.a(cargo staticlib + Tauri Swift shim 的 libtool 合并产物)由
# scripts/build-device.sh 预构建并放入 Externals/arm64/<config>/,本阶段仅校验存在。
if [ ! -f "Externals/arm64/${CONFIGURATION}/libapp.a" ]; then
  echo "error: 缺少预构建 libapp.a —— 先跑 scripts/build-device.sh" >&2
  exit 1
fi
echo "[build-rust-stub] 使用预构建 Externals/arm64/${CONFIGURATION}/libapp.a"
