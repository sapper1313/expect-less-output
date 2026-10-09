#!/bin/bash
# Installs the Expect Less Output watchdog as a launchd job that runs every 5 minutes.
set -e
DATA="${ELO_DATA_DIR:-$HOME/Library/Application Support/Expect Less Output}"
HERE="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.expectlessmedia.elo.watchdog"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$DATA" "$HOME/Library/LaunchAgents"
cp "$HERE/elo-watchdog.sh" "$DATA/elo-watchdog.sh"
chmod +x "$DATA/elo-watchdog.sh"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$DATA/elo-watchdog.sh</string></array>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardErrorPath</key><string>$DATA/watchdog.log</string>
  <key>StandardOutPath</key><string>$DATA/watchdog.log</string>
</dict>
</plist>
PLISTEOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "The watchdog is installed. It checks every 5 minutes."
