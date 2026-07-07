#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
agent_dir="$HOME/Library/LaunchAgents"
log_dir="$HOME/Library/Logs/meow-ops"
gui_domain="gui/$(id -u)"

install_agent() {
  local label="$1"
  local source="$repo_root/sync/$label.plist"
  local target="$agent_dir/$label.plist"

  mkdir -p "$agent_dir" "$log_dir"
  sed \
    -e "s|YOUR_REPO_PATH|$repo_root|g" \
    -e "s|YOUR_HOME|$HOME|g" \
    "$source" > "$target"
  launchctl bootout "$gui_domain" "$target" >/dev/null 2>&1 || true
  launchctl bootstrap "$gui_domain" "$target"
  echo "installed $label"
}

install_agent "com.meowops.localapi"
install_agent "com.meowops.daily-digest"
