#!/usr/bin/env bash
# Offline test (Linear FMK-15). Run while the app is up: scripts/offline-check.sh (PORT defaults to 3000).
set -euo pipefail
cd "$(dirname "$0")/.."
export PORT=${PORT:-3000}
base=http://localhost:$PORT
passed=0 failed=0

step() {
  local name=$1; shift
  echo "-- $name"
  if "$@"; then echo "PASS  $name"; passed=$((passed + 1)); else echo "FAIL  $name"; failed=$((failed + 1)); fi
}

no_outbound_hosts() {
  [ -f .next/BUILD_ID ] || { echo "  no build in .next: run npm run build first"; return 1; }
  local agent=${AGENT_URL:-} found
  agent=${agent#*://}; agent=${agent%%[:/]*}
  # src too: the custom server runs src/engine directly through tsx, not from .next.
  # The last six are framework reference strings, never fetched: doc, error and license links, XML namespaces, the AMP script (no AMP pages here).
  found=$(grep -rhoIE 'https?://[A-Za-z0-9.-]+' .next server src --exclude-dir=cache | sed -E 's#^https?://##' | grep '\.' | sort -u \
    | grep -vxF -e localhost -e 127.0.0.1 -e 0.0.0.0 -e github.com -e openstreetmap.org -e www.openstreetmap.org ${agent:+-e "$agent"} \
      -e nextjs.org -e react.dev -e reactjs.org -e www.w3.org -e tailwindcss.com -e cdn.ampproject.org || true)
  [ -z "$found" ] || { echo "$found" | sed 's/^/  outbound host in code: /'; return 1; }
}

pages_answer() {
  local p code bad=0
  for p in / /console /operator; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$base$p" || true)
    echo "  GET $p -> $code"
    [ "$code" = 200 ] || bad=1
  done
  return $bad
}

world_arrives() {
  node -e '
    const ws = new (require("ws"))(`ws://localhost:${process.env.PORT}/ws`);
    const fail = (m) => { console.log("  " + m); process.exit(1); };
    setTimeout(() => fail("no world message within 3 s"), 3000);
    ws.on("error", (e) => fail(e.code || e.message));
    ws.on("message", (m) => {
      const msg = JSON.parse(m);
      if (msg.type !== "world") return;
      console.log(`  world at ${msg.world.clock.simT}, ${msg.world.tracks.length} tracks, agent ${msg.world.ui.agentMode}`);
      process.exit(0);
    });
  '
}

post() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST -H 'content-type: application/json' -d "$1" "$base/api/operator" || true)
  [ "$code" = 204 ] || { echo "  POST /api/operator $1 -> $code"; return 1; }
}

incident_alert() {
  post '{"cmd":"scenario","value":"incident","ending":"with"}' && post '{"cmd":"speed","value":4}' || return 1
  # Loading a scenario empties world.alerts, so any matching active alert is from this run.
  node -e '
    const ws = new (require("ws"))(`ws://localhost:${process.env.PORT}/ws`);
    const t0 = Date.now();
    const fail = (m) => { console.log("  " + m); process.exit(1); };
    setTimeout(() => fail("no active crossing_on_landing_runway warning within 60 s"), 60000);
    ws.on("error", (e) => fail(e.code || e.message));
    ws.on("message", (m) => {
      const msg = JSON.parse(m);
      const a = msg.type === "world" && msg.world.alerts.find((x) =>
        x.status === "active" && x.level === "warning" && x.conflict.rule === "crossing_on_landing_runway");
      if (!a) return;
      console.log(`  after ${((Date.now() - t0) / 1000).toFixed(1)} s wall: ${a.text}`);
      console.log(`  latencyMs ${a.latencyMs}, countdown ${JSON.stringify(a.countdown ?? null)}`);
      process.exit(0);
    });
  '
}

step "1 no outbound hosts in built code" no_outbound_hosts
step "2 pages answer 200" pages_answer
step "3 world message on /ws within 3 s" world_arrives
step "4 incident raises crossing_on_landing_runway warning within 60 s" incident_alert

echo "== $passed passed, $failed failed"
echo "Reminder: this run did not cut the network. Turn Wi-Fi off (and unplug Ethernet), then run it again."
exit $((failed > 0))
