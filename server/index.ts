// Ground Truth on the GB10: Next, the engine and the /ws world stream on one port. Run with tsx.
import { createServer, type IncomingMessage } from "node:http";
import { networkInterfaces } from "node:os";
import next from "next";
import { WebSocket, WebSocketServer } from "ws";
import { SCENARIO_LABEL, type AgentAlert, type OperatorCommand, type ServerMessage } from "@/lib/contract";
import { createEngine } from "@/engine/engine";
import { createHttpAgent, createMockAgent } from "@/engine/agents";

const port = Number(process.env.PORT) || 3000;
const dev = process.env.NODE_ENV !== "production";
const MAX_BODY = 10 * 1024 * 1024;

const agent = process.env.AGENT_URL
  ? createHttpAgent({
      baseUrl: process.env.AGENT_URL,
      sttPath: process.env.AGENT_STT_PATH,
      parsePath: process.env.AGENT_PARSE_PATH,
      conflictPath: process.env.AGENT_CONFLICT_PATH,
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
