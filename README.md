# Ground Truth web-app

Live airfield picture and runway-incursion alerts for SFO. The app replays a recorded SFO half hour plus scripted scenarios, parses radio calls, and raises alerts in the controller console. One Node process serves the Next.js pages, the engine, and the `/ws` world stream on one port. It needs no internet at run time: fonts come from `@fontsource`, and the airfield geometry and the traffic recording are bundled into the build.

Pages: `/` (splash), `/console` (controller view), `/operator` (demo controls: scenario, speed, play/pause).

## Run on the Dell Pro Max GB10 (DGX OS, ARM64)

Needs Node 20 or newer.

```bash
npm ci               # once, while online. Do not pass --omit=dev: npm start uses tsx.
npm run build
npm start            # NODE_ENV=production tsx server/index.ts, port 3000
```

Or use `scripts/gb10-start.sh`. It checks Node, builds when `src` or `data` changed, can start the agent (`AGENT_CMD`), waits for it, and prints the LAN URLs.

From another device on the same LAN, open:

- `http://<gb10>:3000/console`
- `http://<gb10>:3000/operator`

Every screen shares the one world on the server. The startup log prints the LAN address.

Mic: browsers allow the microphone only on `localhost` or HTTPS. The console on the GB10 itself (`http://localhost:3000/console`) can use the mic. On another device over plain `http://<ip>`, the mic stays off and the rest of the app still works. To allow it, start Chromium with `--unsafely-treat-insecure-origin-as-secure=http://<gb10>:3000`, or use the tunnel below.

## Environment variables

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `3000` | HTTP and `/ws` port |
| `AGENT_URL` | unset | Base URL of the agent. Unset: the built-in mock agent |
| `AGENT_STT_PATH` | `/stt` | Speech-to-text path on the agent |
| `AGENT_PARSE_PATH` | `/parse` | Call-parsing path on the agent |
| `AGENT_CONFLICT_PATH` | `/conflict` | Conflict-review path on the agent |
| `NETWORK` | `offline` | `online` shows the network as online in the UI |
| `AGENT_CMD` | unset | `gb10-start.sh` only: shell command that starts the agent |

Set `NEXT_TELEMETRY_DISABLED=1` so Next never tries to phone home (`gb10-start.sh` does this).

## Radio audio

Put one file per radio call at `public/audio/<call id>.wav`. `scripts/make-audio.ts` writes the list of call ids to `data/audio-manifest.json` (that file does not exist yet). The app only links a call to audio that was listed when the recording was built, so after you add or remove files run:

```bash
npx tsx scripts/build-recording.ts
npm run build
```

`scripts/make-audio.ts` makes stand-in voices with macOS `say`, so run it on a Mac and copy `public/audio/` to the GB10.

## Offline test

1. Start the app (`npm start`).
2. Run `scripts/offline-check.sh` (`PORT=...` if not 3000). It checks for outbound hosts in the build, that `/`, `/console` and `/operator` answer 200, that a world message arrives on `/ws`, and that the incident scenario raises the runway-crossing warning.
3. Turn Wi-Fi off and unplug Ethernet, then run it again. Open `/console` and `/operator` in Chromium on the GB10 and play the incident.

## Remote viewing (tunnel fallback)

When viewers are not on the LAN, run a Cloudflare quick tunnel from the GB10 (needs internet; install the arm64 `cloudflared` while online):

```bash
cloudflared tunnel --url http://localhost:3000
```

It prints an `https://<random>.trycloudflare.com` URL. WebSockets pass through, so remote screens share the GB10 world, and HTTPS lets their mic work.

## Hosted (Vercel or another static host)

`next build` deploys as-is to Vercel. There is no custom server there, so `/ws` fails. After 1.5 s, each tab runs the same engine in the browser with the mock agent. Each tab then has its own world: the operator page does not drive other screens.

If Vercel does not work, the same build runs on Netlify or Cloudflare Pages with the same in-browser fallback. For the full shared world with `/ws`, use a Node host that supports WebSockets (Render, Fly.io, Railway) with `npm ci && npm run build` and `npm start`, or the tunnel above.

## Development

```bash
npm run dev          # tsx server/index.ts in Next dev mode
npm run typecheck
npm run lint
```
