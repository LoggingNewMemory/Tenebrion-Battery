#!/bin/bash

export NDK=/opt/android-ndk
export API=21
TOOLCHAIN=$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin

mkdir -p bin

echo "Building Tenebrion Daemon for ARM64..."
$TOOLCHAIN/aarch64-linux-android$API-clang -Wall -O2 \
    -o bin/TenebrionDaemon_arm64 \
    tenebrion.c utils_arm64.S

echo "Building Normal State Binary..."
$TOOLCHAIN/aarch64-linux-android$API-clang -Wall -O2 \
    -o bin/normal \
    normal.c utils_arm64.S

echo "Building Battery State Binary..."
$TOOLCHAIN/aarch64-linux-android$API-clang -Wall -O2 \
    -o bin/battery \
    battery.c utils_arm64.S

# Strip the binaries to reduce size
$TOOLCHAIN/llvm-strip bin/TenebrionDaemon_arm64
$TOOLCHAIN/llvm-strip bin/normal
$TOOLCHAIN/llvm-strip bin/battery

echo "Build complete! Binaries are in the bin directory."