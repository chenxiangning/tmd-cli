#!/bin/zsh
# 本地发布打包:产物自包含(无 Homebrew 动态库依赖),拷贝到项目根 re-local/
# 用法: npm run release:mac-local
set -euo pipefail
setopt NULL_GLOB  # 清理 glob 无匹配时不报错(首次构建可能还没有 -sys 构建目录)

cd "$(dirname "$0")/.."
ROOT="$PWD"
APP_NAME="tmd-cli"
TARGET="aarch64-apple-darwin"
RELEASE_DIR="$ROOT/src-tauri/target/$TARGET/release"
OUT_DIR="$ROOT/re-local"

# --- 1. 隔离 Homebrew 动态库,强制 openssl 静态链接 -------------------------
# libgit2/openssl 若被 brew 链接进 /opt/homebrew/lib,-sys crate 会优先捡到动态库,
# 导致二进制依赖 /opt/homebrew 路径 → 别的电脑跑不了。unlink + OPENSSL_STATIC 根治。
libgit2_unlinked=0
if brew list --formula | grep -qx libgit2 && brew unlink libgit2 >/dev/null 2>&1; then
	libgit2_unlinked=1
fi
trap '[[ $libgit2_unlinked == 1 ]] && brew link libgit2 >/dev/null 2>&1 || true' EXIT

export OPENSSL_DIR="$(brew --prefix openssl@3)"
export OPENSSL_STATIC=1
export OPENSSL_NO_VENDOR=1

# --- 2. 清掉缓存,保证 -sys crate 按上面的环境变量重新探测链接方式 -----------
rm -rf "$RELEASE_DIR/.fingerprint"
rm -rf "$RELEASE_DIR"/build/libgit2-sys-*
rm -rf "$RELEASE_DIR"/build/openssl-sys-*
rm -f "$RELEASE_DIR/$APP_NAME"
rm -rf "$RELEASE_DIR/bundle"

# --- 3. 构建(复用 build:mac-arm64 入口)-------------------------------------
npm run build:mac-arm64 -- --skip-sign --skip-notarize

# --- 4. 可移植性校验:任何 Homebrew 路径依赖都视为失败 -----------------------
BIN="$RELEASE_DIR/bundle/macos/$APP_NAME.app/Contents/MacOS/$APP_NAME"
if otool -L "$BIN" | grep -E '/opt/homebrew|/usr/local/(opt|Cellar)'; then
	echo "[release] 失败: 二进制依赖 Homebrew 动态库,别的电脑无法直接运行" >&2
	exit 1
fi
echo "[release] 依赖校验通过: 仅链接系统框架,可拷贝到任意 Mac 运行"

# --- 5. 收集产物到 re-local/ -------------------------------------------------
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
cp -R "$RELEASE_DIR/bundle/macos/$APP_NAME.app" "$OUT_DIR/"
cp "$RELEASE_DIR"/bundle/dmg/*.dmg "$OUT_DIR/"

echo "[release] 产物已输出:"
ls -lh "$OUT_DIR"
