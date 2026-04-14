#!/usr/bin/env bash
# build.sh — compile MeowOpsBar and install to ~/Applications/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="MeowOpsBar"
BUILD_DIR="$SCRIPT_DIR/build"
APP_BUNDLE="$BUILD_DIR/$APP_NAME.app"
INSTALL_DIR="$HOME/Applications"

echo "🐾 Building $APP_NAME..."

# Clean
rm -rf "$BUILD_DIR"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"

# Compile
swiftc \
    -O \
    -target arm64-apple-macosx13.0 \
    -framework AppKit \
    -framework Foundation \
    -o "$APP_BUNDLE/Contents/MacOS/$APP_NAME" \
    "$SCRIPT_DIR/MeowOpsBar.swift"

# Copy plist + icon
cp "$SCRIPT_DIR/Info.plist" "$APP_BUNDLE/Contents/Info.plist"
[ -f "$SCRIPT_DIR/AppIcon.icns" ] && cp "$SCRIPT_DIR/AppIcon.icns" "$APP_BUNDLE/Contents/Resources/AppIcon.icns"

# Ad-hoc code sign (no Apple Developer account needed)
codesign --force --deep --sign - "$APP_BUNDLE"

echo "  Compiled and signed."

# Install
mkdir -p "$INSTALL_DIR"
rm -rf "$INSTALL_DIR/$APP_NAME.app"
cp -R "$APP_BUNDLE" "$INSTALL_DIR/"

echo "  Installed to $INSTALL_DIR/$APP_NAME.app"
echo ""
echo "  Launch: open ~/Applications/$APP_NAME.app"
echo "  Or run: open \"\$HOME/Applications/$APP_NAME.app\""
