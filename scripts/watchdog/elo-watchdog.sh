#!/bin/bash
# Expect Less Output watchdog. Run by launchd every 5 minutes, separately from the app.
# The app cannot alert you if it is dead, so this checks the heartbeat file the Director writes every pass.
# If the heartbeat is older than the limit during run hours, it sends one iMessage (again after 2 hours if still down).
# Settings come from watchdog.env, which the app rewrites whenever you change them.

DATA="${ELO_DATA_DIR:-$HOME/Library/Application Support/Expect Less Output}"
ENV_FILE="$DATA/watchdog.env"
HEARTBEAT="$DATA/studio-heartbeat.txt"
STATE="$DATA/watchdog-state.txt"

[ -f "$ENV_FILE" ] || exit 0
# shellcheck disable=SC1090
. "$ENV_FILE"
[ "${ELO_ENABLED:-1}" = "1" ] || exit 0

NOW="${ELO_NOW:-$(date +%s)}"
LAST=0
[ -f "$HEARTBEAT" ] && LAST=$(tr -dc '0-9' < "$HEARTBEAT")
[ -z "$LAST" ] && LAST=0
AGE_MIN=$(( (NOW - LAST) / 60 ))

# Run hours are Eastern time, as HHMM numbers.
HHMM=$(TZ=America/New_York date ${ELO_NOW:+-r "$ELO_NOW"} +%H%M)
HHMM=$((10#$HHMM))
START=$((10#${ELO_RUN_START:-0700}))
END=$((10#${ELO_RUN_END:-2200}))
if [ "$HHMM" -lt "$START" ] || [ "$HHMM" -ge "$END" ]; then exit 0; fi

THRESHOLD="${ELO_THRESHOLD_MIN:-30}"
if [ "$AGE_MIN" -le "$THRESHOLD" ]; then
  rm -f "$STATE"   # healthy again, so the next outage alerts right away
  exit 0
fi

LAST_ALERT=0
[ -f "$STATE" ] && LAST_ALERT=$(tr -dc '0-9' < "$STATE")
[ -z "$LAST_ALERT" ] && LAST_ALERT=0
if [ $((NOW - LAST_ALERT)) -lt 7200 ]; then exit 0; fi

TEXT="Expect Less Output has stopped. Nothing has checked in for ${AGE_MIN} minutes, so posts may be missed. Open the app on the Mac."
SEND="${ELO_SEND_CMD:-}"
if [ -n "$SEND" ]; then
  "$SEND" "$ELO_PHONE" "$TEXT"
else
  /usr/bin/osascript - "$ELO_PHONE" "$TEXT" <<'APPLESCRIPT' 2>/dev/null || /usr/bin/osascript - "$ELO_PHONE" "$TEXT" <<'APPLESCRIPT2'
on run argv
  set theNumber to item 1 of argv
  set theText to item 2 of argv
  tell application "Messages"
    set targetService to 1st account whose service type = iMessage
    set targetBuddy to participant theNumber of targetService
    send theText to targetBuddy
  end tell
end run
APPLESCRIPT
on run argv
  set theNumber to item 1 of argv
  set theText to item 2 of argv
  tell application "Messages"
    set targetService to 1st service whose service type = iMessage
    set targetBuddy to buddy theNumber of targetService
    send theText to targetBuddy
  end tell
end run
APPLESCRIPT2
fi
echo "$NOW" > "$STATE"
