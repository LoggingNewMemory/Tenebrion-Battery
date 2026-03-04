#!/bin/bash

export NDK=/opt/android-ndk
export API=21
TOOLCHAIN=$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin

# Directories
OUT_DIR="Modules"
SRC_DIR="Sources"

mkdir -p "$OUT_DIR/Binaries"
mkdir -p "$OUT_DIR/webroot/cgi-bin"

echo "[1/3] Building Native C Binaries..."
$TOOLCHAIN/aarch64-linux-android$API-clang -Wall -O2 -I"$SRC_DIR" -o "$OUT_DIR/Binaries/TenebrionDaemon_arm64" "$SRC_DIR/tenebrion.c" "$SRC_DIR/utils_arm64.S"
$TOOLCHAIN/aarch64-linux-android$API-clang -Wall -O2 -I"$SRC_DIR" -o "$OUT_DIR/Binaries/normal" "$SRC_DIR/normal.c" "$SRC_DIR/utils_arm64.S"
$TOOLCHAIN/aarch64-linux-android$API-clang -Wall -O2 -I"$SRC_DIR" -o "$OUT_DIR/Binaries/battery" "$SRC_DIR/battery.c" "$SRC_DIR/utils_arm64.S"

$TOOLCHAIN/llvm-strip "$OUT_DIR/Binaries/TenebrionDaemon_arm64"
$TOOLCHAIN/llvm-strip "$OUT_DIR/Binaries/normal"
$TOOLCHAIN/llvm-strip "$OUT_DIR/Binaries/battery"

echo "[2/3] Building WebUI via Parcel..."
cd "$SRC_DIR/WebUI" || exit
npm install
# Build the frontend into the module's webroot directory. Use --public-url ./ to fix asset paths.
npx parcel build index.html --dist-dir "../../$OUT_DIR/webroot" --public-url ./
cd ../../

echo "[3/3] Deploying Backend CGI API..."
cp "$SRC_DIR/WebUI/backend.sh" "$OUT_DIR/webroot/cgi-bin/api"
chmod 755 "$OUT_DIR/webroot/cgi-bin/api"
cp "$SRC_DIR/WebUI/Banner.png" "$OUT_DIR/webroot/" 2>/dev/null

echo "Build complete! Output is in $OUT_DIR/"