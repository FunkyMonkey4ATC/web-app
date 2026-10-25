// Ground Truth on the GB10: Next, the engine and the /ws world stream on one port. Run with tsx.
import { createServer, type IncomingMessage } from "node:http";
import { networkInterfaces } from "node:os";
import next from "next";
import { WebSocket, WebSocketServer } from "ws";
import { SCENARIO_LABEL, type AgentAlert, type OperatorCommand, type ServerMessage, type Track, type Weather } from "@/lib/contract";
import { createEngine } from "@/engine/engine";
import { createHttpAgent, createMockAgent } from "@/engine/agents";
import { adsbLolToTracks, metarToWeather, openskyToTracks } from "@/engine/sim/live";

const port = Number(process.env.PORT) || 3000;
const dev = process.env.NODE_ENV !== "production";
const MAX_BODY = 10 * 1024 * 1024;

const agent = process.env.AGENT_URL
  ? createHttpAgent({
      baseUrl: process.env.AGENT_URL,
      sttPath: process.env.AGENT_STT_PATH,
      parsePath: process.env.AGENT_PARSE_PATH,
      conflictPath: process.env.AGENT_CONFLICT_PATH,
      audioBase: `http://127.0.0.1:${port}`, // scenario clips go to the gateway's speech model
      timeouts: { stt: Number(process.env.AGENT_STT_MS) || undefined, parse: Number(process.env.AGENT_PARSE_MS) || undefined, judge: Number(process.env.AGENT_JUDGE_MS) || undefined },
    })
  : createMockAgent();
const engine = createEngine({ agent, network: process.env.NETWORK === "online" ? "online" : "offline" });

function body(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("body too large")); req.destroy(); } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
const json = async (req: IncomingMessage) => JSON.parse(String(await body(req))) as Record<string, unknown>;

// Validate everything that crosses the network before it reaches the engine.
const oneOf = (v: unknown, ...ok: unknown[]) => ok.includes(v);
const strings = (v: unknown) => Array.isArray(v) && v.every((s) => typeof s === "string");
function isCommand(c: Record<string, unknown>): boolean {
  switch (c.cmd) {
    case "play": case "pause": case "restart": case "reset": return true;
    case "speed": return oneOf(c.value, 1, 2, 4);
    case "scenario": return typeof c.value === "string" && Object.hasOwn(SCENARIO_LABEL, c.value) && oneOf(c.ending, undefined, "with", "without");
    case "jump": return c.value === "before_crossing";
    case "rail": return typeof c.value === "boolean";
    case "threshold": return typeof c.value === "number" && c.value >= 0 && c.value <= 1;
    case "config": return strings(c.arr) && strings(c.dep);
  }
  return false;
}

// Live SFO traffic: while the scenario is "live", poll ADS-B every 5 s and the KSFO METAR every 5 min.
const ADSB = "https://api.adsb.lol/v2/point/37.6188/-122.3750/12";
const OPENSKY = "https://opensky-network.org/api/states/all?lamin=37.55&lomin=-122.45&lamax=37.70&lomax=-122.30";
const METAR = "https://aviationweather.gov/api/data/metar?ids=KSFO&format=json";
const getJson = async (url: string): Promise<unknown> => {
  // adsb.lol answers 403 to Node's default User-Agent ("too generic")
  const res = await fetch(url, { headers: { "user-agent": "GroundTruth/0.1 (SFO runway safety demo)" }, signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json();
};
let liveTimers: ReturnType<typeof setInterval>[] = [], liveWx: Weather | undefined, liveBusy = false, liveLogged = 0;
async function pollPositions() {
  if (liveBusy) return; // adsb.lol then OpenSky can take 8 s; never stack polls
  liveBusy = true;
  const t = new Date().toISOString();
  let from = "adsb.lol", tracks: Track[] | null = null;
  try { tracks = adsbLolToTracks(await getJson(ADSB), t); } catch (err) {
    from = "OpenSky";
    try { tracks = openskyToTracks(await getJson(OPENSKY), t); } catch (err2) { console.warn(`live: positions failed (${err}; ${err2}), keeping the last frame`); }
  }
  liveBusy = false;
  if (!tracks || !liveTimers.length) return; // failed, or live ended while fetching
  engine.live({ tracks, weather: liveWx });
  if (Date.now() - liveLogged >= 60_000) { liveLogged = Date.now(); console.log(`live: ${tracks.length} tracks from ${from}, ${liveWx?.metar ?? "no METAR yet"}`); }
}
const pollMetar = () => getJson(METAR).then((j) => { liveWx = metarToWeather(j) ?? liveWx; }).catch((err) => console.warn(`live: METAR failed (${err})`));
engine.subscribe((w) => {
  const want = w.clock.scenario === "live" && process.env.NETWORK !== "offline";
  if (want === !!liveTimers.length) return;
  liveTimers.forEach(clearInterval);
  liveTimers = want ? [setInterval(pollPositions, 5000), setInterval(pollMetar, 300_000)] : [];
  if (want) { liveLogged = 0; void pollMetar().then(pollPositions); }
  console.log(want ? "live: polling SFO ADS-B and METAR" : "live: stopped");
});

const routes: Record<string, (req: IncomingMessage) => Promise<boolean>> = {
  "/api/operator": async (req) => {
    const c = await json(req);
    if (!isCommand(c)) return false;
    engine.command(c as unknown as OperatorCommand);
    return true;
  },
  "/api/feedback": async (req) => {
    const { alertId, response } = await json(req);
    if (typeof alertId !== "string" || (response !== "ack" && response !== "false_alarm")) return false;
    engine.feedback(alertId, response);
    return true;
  },
  "/api/alerts": async (req) => {
    const a = await json(req);
    if (!oneOf(a.severity, "high", "medium", "low") || typeof a.text !== "string" || typeof a.alertId !== "string"
      || !oneOf(typeof a.reasoning, "undefined", "string") || !oneOf(a.outbox, undefined, "queued", "sent", "failed")) return false;
    engine.agentAlert(a as unknown as AgentAlert);
    return true;
  },
  "/api/mic": async (req) => {
    const audio = new Uint8Array(await body(req)).buffer; // a copy that owns exactly this clip
    await engine.micUtterance(audio, req.headers["content-type"] ?? "audio/webm");
    return true;
  },
};

const app = next({ dev, port });
const handle = app.getRequestHandler();
const wss = new WebSocketServer({ noServer: true });
const message = () => JSON.stringify({ type: "world", world: engine.getWorld() } satisfies ServerMessage);

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    const route = req.method === "POST" && routes[(req.url ?? "").split("?")[0]];
    if (!route) return handle(req, res);
    try { res.statusCode = (await route(req)) ? 204 : 400; } catch { res.statusCode = 400; }
    res.end();
  });
  // Only /ws is ours; Next attaches its own upgrade listener for HMR on the first request.
  server.on("upgrade", (req, socket, head) => {
    if ((req.url ?? "").split("?")[0] === "/ws") wss.handleUpgrade(req, socket, head, (ws) => ws.send(message()));
  });

  let last = 0, queued = false; // at most 10 world messages a second, always the latest world
  engine.subscribe(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      last = Date.now();
      const m = message();
      for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) ws.send(m);
    }, Math.max(0, last + 100 - Date.now()));
  });

  server.listen(port, "0.0.0.0", () => {
    engine.start();
    const lan = Object.values(networkInterfaces()).flat().find((i) => i?.family === "IPv4" && !i.internal)?.address;
    console.log(`Ground Truth ready on http://localhost:${port}${lan ? ` (LAN http://${lan}:${port})` : ""}, agent ${agent.mode}, ${dev ? "dev" : "production"}`);
  });
});
