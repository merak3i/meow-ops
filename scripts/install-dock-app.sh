#!/usr/bin/env bash
# install-dock-app.sh — install "Meow Ops Local" into ~/Applications and pin it to the Dock.
#
# Clicking it:
#   1. starts the local helper (7337) and dashboard (4273) LaunchAgents if they are down,
#   2. asks the helper for a fresh session sync,
#   3. opens http://127.0.0.1:4273 in its own Chrome app window (default browser if no Chrome).
#
# Private data stays on this Mac: the local dashboard reads the helper directly.
# Usage: bash scripts/install-dock-app.sh   (or curl -fsSL <raw url> | bash)
# Remove: rm -rf ~/Applications/"Meow Ops Local.app", then drag it out of the Dock.
set -euo pipefail

APP_NAME="Meow Ops Local"
INSTALL_DIR="$HOME/Applications"
APP="$INSTALL_DIR/$APP_NAME.app"
ICON_URL="https://raw.githubusercontent.com/merak3i/meow-ops/main/menubar/AppIcon.icns"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo "")"

[ "$(uname -s)" = "Darwin" ] || { echo "macOS only." >&2; exit 1; }

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>meow-ops-local</string>
  <key>CFBundleIdentifier</key><string>com.meowcreativehaus.meow-ops-local</string>
  <key>CFBundleName</key><string>Meow Ops Local</string>
  <key>CFBundleDisplayName</key><string>Meow Ops Local</string>
  <key>CFBundleVersion</key><string>1.0.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

cat > "$APP/Contents/MacOS/meow-ops-local" <<'LAUNCHER'
#!/bin/bash
# Meow Ops Local launcher. Logs: ~/Library/Logs/meow-ops/dock-launcher.log
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
URL="http://127.0.0.1:4273/#/today/summary"
HELPER="http://127.0.0.1:7337"
DOMAIN="gui/$(id -u)"
AGENTS="$HOME/Library/LaunchAgents"
LOG="$HOME/Library/Logs/meow-ops/dock-launcher.log"
mkdir -p "$(dirname "$LOG")"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

up() { curl -fsS -o /dev/null --max-time 2 "$1"; }

ensure() {
  local label="$1" probe="$2"
  up "$probe" && return 0
  if [ ! -f "$AGENTS/$label.plist" ]; then
    log "missing $label.plist"
    return 1
  fi
  log "starting $label"
  launchctl print "$DOMAIN/$label" >/dev/null 2>&1 \
    || launchctl bootstrap "$DOMAIN" "$AGENTS/$label.plist" >/dev/null 2>&1
  launchctl kickstart "$DOMAIN/$label" >/dev/null 2>&1
  for _ in $(seq 1 30); do up "$probe" && return 0; sleep 0.5; done
  log "$label did not come up"
  return 1
}

helper_ok=0; dash_ok=0
ensure com.meowops.sanctum-helper "$HELPER/sync/status" && helper_ok=1
ensure com.meowops.dashboard "http://127.0.0.1:4273/" && dash_ok=1

if [ "$helper_ok" = 1 ]; then
  # No Origin header: the helper treats this as a local caller.
  curl -fsS -o /dev/null --max-time 5 -X POST "$HELPER/sync" && log "sync requested" || log "sync request failed"
fi

if [ "$dash_ok" != 1 ]; then
  osascript -e 'display dialog "Meow Ops local services are not installed or failed to start.\n\nIn Terminal, inside your meow-ops folder, run:\nnpm run build && npm run agents:install\n\nDetails: ~/Library/Logs/meow-ops/" buttons {"OK"} default button "OK" with title "Meow Ops Local" with icon caution' >/dev/null 2>&1
  exit 1
fi

if [ -d "/Applications/Google Chrome.app" ] || [ -d "$HOME/Applications/Google Chrome.app" ]; then
  open -na "Google Chrome" --args --app="$URL"
else
  open "$URL"
fi
log "opened dashboard"
LAUNCHER
chmod 755 "$APP/Contents/MacOS/meow-ops-local"

# Icon: repo copy when run from a clone, otherwise the published one.
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/../menubar/AppIcon.icns" ]; then
  cp "$SCRIPT_DIR/../menubar/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
else
  curl -fsSL "$ICON_URL" -o "$APP/Contents/Resources/AppIcon.icns" || echo "  (icon download failed; using default icon)"
fi

codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
touch "$APP"

# Pin to the Dock once.
if defaults read com.apple.dock persistent-apps 2>/dev/null | grep -q "Meow%20Ops%20Local.app"; then
  echo "  Already in the Dock."
else
  defaults write com.apple.dock persistent-apps -array-add \
    "<dict><key>tile-data</key><dict><key>file-data</key><dict><key>_CFURLString</key><string>file://${APP// /%20}/</string><key>_CFURLStringType</key><integer>15</integer></dict></dict></dict>"
  killall Dock
  echo "  Pinned to the Dock."
fi

echo "  Installed: $APP"
echo "  Open now:  open \"$APP\""
