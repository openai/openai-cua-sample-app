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
swiftc -O -o macos_ax \
    macos-support/ax/Sources/main.swift \
    macos-support/ax/Sources/KeyboardUtils.swift

echo "Making binary executable..."
chmod +x macos_ax

echo "Testing AX controller..."
./macos_ax help

echo "AX controller built successfully!" 