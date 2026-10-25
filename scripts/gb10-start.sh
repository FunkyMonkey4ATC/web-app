#!/usr/bin/env bash
# Start Ground Truth on the Dell Pro Max GB10: build if needed, start Chris's agent (optional), then the web-app.
# Env: PORT (default 3000), AGENT_CMD (shell command that starts Chris's agent), AGENT_URL (agent base URL; the server uses the live agent when set).
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=${PORT:-3000}

node -e 'process.exit(+process.versions.node.split(".")[0] >= 20 ? 0 : 1)' || { echo "Node 20 or newer required, found $(node -v)"; exit 1; }
[ -d node_modules ] || { echo "node_modules missing: run npm ci once while online"; exit 1; }
if curl -s -o /dev/null --max-time 1 "http://localhost:$PORT/"; then echo "Port $PORT already answers: stop the running instance first"; exit 1; fi

export NEXT_TELEMETRY_DISABLED=1 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
# The bundle embeds src and data; server/ and public/ are read at run time and need no rebuild.
if [ ! -f .next/BUILD_ID ] || [ -n "$(find src data next.config.ts -newer .next/BUILD_ID -print -quit)" ]; then
  npm run build
fi

mkdir -p logs
# kill 0 signals the whole process group, so npx, tsx, node and any shell inside AGENT_CMD stop too.
stop() { trap '' INT TERM; kill 0 2>/dev/null || true; wait || true; }
trap stop EXIT
trap 'exit 130' INT TERM

if [ -n "${AGENT_CMD:-}" ]; then
  echo "Starting agent: $AGENT_CMD (log: logs/agent.log)"
  bash -c "$AGENT_CMD" >> logs/agent.log 2>&1 &
fi
if [ -n "${AGENT_URL:-}" ]; then
  # Any HTTP answer counts: the agent's health path is Chris's to define.
  up=0
  for _ in $(seq 60); do
    if curl -s -o /dev/null --max-time 1 "$AGENT_URL"; then up=1; break; fi
    sleep 1
  done
  if [ $up = 1 ]; then echo "Agent answers at $AGENT_URL"
  else echo "WARNING: no answer from $AGENT_URL after 60 s (see logs/agent.log). Unset AGENT_URL to use the mock agent."; fi
fi

echo "Starting web-app on port $PORT (log: logs/web.log)"
NODE_ENV=production PORT=$PORT npx tsx server/index.ts > >(tee -a logs/web.log) 2>&1 &
web=$!
until curl -s -o /dev/null --max-time 1 "http://localhost:$PORT/"; do
  kill -0 $web 2>/dev/null || { echo "web-app exited during startup: see logs/web.log"; exit 1; }
  sleep 1
done

echo "Ground Truth is up. Open on the LAN:"
for ip in localhost $( (hostname -I 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || true) | tr ' ' '\n' | grep -E '^[0-9.]+$' || true); do
  echo "  console   http://$ip:$PORT/console"
  echo "  operator  http://$ip:$PORT/operator"
done
echo "Ctrl+C stops everything."
wait $web
