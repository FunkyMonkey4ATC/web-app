#!/usr/bin/env bash
# Full-resolution screenshots of every screen and state: scripts/shots.sh [baseUrl=http://localhost:3000] [outDir=/tmp/gt-shots]
# Needs the server running at baseUrl. Restores scenario normal, speed 1, rail closed at the end.
set -euo pipefail
base=${1:-http://localhost:3000}; base=${base%/}
out=${2:-/tmp/gt-shots}
mkdir -p "$out"

chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -x "$chrome" ]; then
  chrome=$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)
  [ -n "$chrome" ] || { echo "no Chrome or Chromium found" >&2; exit 1; }
fi

op() { curl -sf -X POST -H 'content-type: application/json' -d "$1" "$base/api/operator" >/dev/null; }
restore() { op '{"cmd":"rail","value":false}' || true; op '{"cmd":"scenario","value":"normal"}' || true; op '{"cmd":"speed","value":1}' || true; }
trap restore EXIT

# shot <name> <path> <WxH> [virtual ms]
shot() {
  local file="$out/$1-$3.png" profile
  profile=$(mktemp -d)
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --no-first-run --user-data-dir="$profile" \
    --window-size="${3/x/,}" --virtual-time-budget="${4:-4000}" --screenshot="$file" "$base$2" >/dev/null 2>&1
  rm -rf "$profile"
  [ -s "$file" ] || { echo "no screenshot: $file (is $base up?)" >&2; return 1; }
  echo "$file"
}
# both desktop sizes at once, so a timed state is caught in both
desk() { shot "$1" "$2" 1920x1080 "${3:-}" & local big=$!; shot "$1" "$2" 1440x900 "${3:-}"; wait "$big"; }

op '{"cmd":"rail","value":false}'
op '{"cmd":"scenario","value":"normal"}'
op '{"cmd":"speed","value":1}'
op '{"cmd":"play"}'
sleep 5
desk console-normal /console

op '{"cmd":"scenario","value":"incident","ending":"with"}'
op '{"cmd":"jump","value":"before_crossing"}'
op '{"cmd":"play"}'
sleep 15
desk console-alert /console
op '{"cmd":"rail","value":true}'
desk console-rail /console
op '{"cmd":"rail","value":false}'

desk landing / 16000
shot landing / 390x844 16000
desk operator /operator
shot operator /operator 390x844
