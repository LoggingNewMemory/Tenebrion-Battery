#!/bin/bash

export NDK=/opt/android-ndk
export API=21
TOOLCHAIN=$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin

# Project structure directories
OUT_DIR="Modules/Binaries"
SRC_DIR="Sources"

# Create output directory (will create Modules/ if it doesn't exist)
mkdir -p "$OUT_DIR"

echo "Building Tenebrion Daemon for ARM64..."
$TOOLCHAIN/aarch64-linux-android$API-clang -Wall -O2 -I"$SRC_DIR" \
    -o "$OUT_DIR/TenebrionDaemon_arm64" \
    "$SRC_DIR/tenebrion.c" "$SRC_DIR/utils_arm64.S"

echo "Building Normal State Binary..."
$TOOLCHAIN/aarch64-linux-android$API-clang -Wall -O2 -I"$SRC_DIR" \
    -o "$OUT_DIR/normal" \
    "$SRC_DIR/normal.c" "$SRC_DIR/utils_arm64.S"

echo "Building Battery State Binary..."
$TOOLCHAIN/aarch64-linux-android$API-clang -Wall -O2 -I"$SRC_DIR" \
    -o "$OUT_DIR/battery" \
    "$SRC_DIR/battery.c" "$SRC_DIR/utils_arm64.S"

# Strip the binaries to reduce size
echo "Stripping binaries..."
$TOOLCHAIN/llvm-strip "$OUT_DIR/TenebrionDaemon_arm64"
$TOOLCHAIN/llvm-strip "$OUT_DIR/normal"
$TOOLCHAIN/llvm-strip "$OUT_DIR/battery"

echo "Build complete! Compiled binaries are located in $OUT_DIR/"