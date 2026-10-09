#!/bin/bash
# Removes the Expect Less Output watchdog.
DATA="${ELO_DATA_DIR:-$HOME/Library/Application Support/Expect Less Output}"
LABEL="com.expectlessmedia.elo.watchdog"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist" "$DATA/elo-watchdog.sh" "$DATA/watchdog-state.txt"
echo "The watchdog is removed."
