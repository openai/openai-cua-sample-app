#!/bin/bash
# Build script for AX controller

# Exit immediately if a command exits with a non-zero status
set -e

# Make the script executable if it isn't already
[ -x "$0" ] || { chmod +x "$0"; echo "Made script executable"; }

echo "Building AX controller..."

# Create output directory if it doesn't exist
mkdir -p .build

# Directly compile the Swift files using swiftc
echo "Compiling Swift files..."
swiftc -O -o ax_controller \
    AXController/Sources/main.swift \
    AXController/Sources/KeyboardUtils.swift

echo "Making binary executable..."
chmod +x ax_controller

echo "Testing AX controller..."
./ax_controller help

echo "AX controller built successfully!" 