#!/bin/bash

export NDK=/opt/android-ndk
export API=21
TOOLCHAIN=$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin

# Create output directory
mkdir -p bin

# Build for ARM64 (Compiling both C and ASM64)
echo "Building Tenebrion Core for ARM64..."

$TOOLCHAIN/aarch64-linux-android$API-clang -Wall -O2 \
    -o bin/TenebrionDaemon_arm64 \
    tenebrion.c utils_arm64.S

# Strip the binary to reduce size
$TOOLCHAIN/llvm-strip bin/TenebrionDaemon_arm64

echo "Build complete! Binary is in the bin directory."