// End-to-end scenario check against a running server: node scripts/e2e.cjs [baseUrl=http://localhost:3000]
// Drives /api/operator, watches the /ws world stream, prints PASS/FAIL per scenario, exits non-zero on any failure.
const WebSocket = require("ws"); // eslint-disable-line @typescript-eslint/no-require-imports -- plain CommonJS script
const base = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const STEP_MS = 60000;

let world = null;
const watchers = new Set();
const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws");
ws.on("message", (m) => {
  const msg = JSON.parse(m);
  if (msg.type === "world") { world = msg.world; for (const f of watchers) f(world); }
});

const post = (b) => fetch(`${base}/api/operator`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) })
  .then((r) => { if (r.status !== 204) throw new Error(`POST ${JSON.stringify(b)} -> ${r.status}`); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Resolves with the first truthy pred(world) and the wall seconds it took.
const until = (name, ms, pred) => new Promise((res, rej) => {
  const t0 = Date.now();
  const f = (w) => { const v = pred(w); if (v) { watchers.delete(f); clearTimeout(to); res({ v, s: (Date.now() - t0) / 1000 }); } };
  const to = setTimeout(() => { watchers.delete(f); rej(new Error(`timeout ${ms / 1000} s waiting for ${name}`)); }, ms);
  watchers.add(f);
  if (world) f(world);
});
// Calls f on every frame until stop() is called.
const watch = (f) => { watchers.add(f); return () => watchers.delete(f); };

async function start(scenario, ending) {
  await post({ cmd: "scenario", value: scenario, ...(ending ? { ending } : {}) });
  await post({ cmd: "speed", value: 4 });
  await post({ cmd: "play" });
  const want = ending ?? (scenario === "incident" ? "with" : undefined);
  await until(`${scenario} to load`, 5000, (w) => w.clock.scenario === scenario && w.clock.speed === 4 && w.clock.ending === want);
  return new Set(world.alerts.map((a) => a.id)); // alerts left over from before the load
}

let failed = 0;
async function step(name, fn) {
  try { console.log(`PASS ${name}: ${await fn()}`); } catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); }
}
const isRule1 = (a) => a.conflict?.rule === "crossing_on_landing_runway";

async function main() {
  await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });

  await step("(a) incident with: crossing call, warning, resolve", async () => {
    await start("incident", "with");
    const x = await until("cross_runway 28L call", STEP_MS, (w) => w.calls.find((c) => c.clearance?.action === "cross_runway" && c.clearance.runway === "28L"));
    console.log(`  call ${x.v.id} "${x.v.transcript}" conf ${x.v.clearance.confidence}`);
    const f = await until("active rule 1 warning with latencyMs", STEP_MS, (w) =>
      w.alerts.find((a) => a.status === "active" && a.level === "warning" && isRule1(a) && typeof a.latencyMs === "number"));
    console.log(`  alert ${f.v.id} latencyMs ${f.v.latencyMs}, countdown ${JSON.stringify(f.v.countdown ?? null)}, banner ${f.v.banner}`);
    const r = await until("rule 1 to resolve", STEP_MS, (w) => w.alerts.find((a) => a.id === f.v.id && a.status === "resolved"));
    return `latencyMs ${f.v.latencyMs}, resolved ${r.s.toFixed(1)} s after firing`;
  });

  await step("(b) normal 75 s at 4x: zero warnings", async () => {
    const old = await start("normal");
    const warn = new Map(), caut = new Set();
    const stop = watch((w) => { for (const a of w.alerts) if (!old.has(a.id)) { if (a.level === "warning") warn.set(a.id, `${a.conflict?.rule}: ${a.text}`); else caut.add(a.id); } });
    await sleep(75000);
    stop();
    if (warn.size) throw new Error(`${warn.size} warnings: ${[...warn.values()].join(" | ")}`);
    return `0 warnings, ${caut.size} cautions, ${world.stats.calls} calls`;
  });

  await step("(c) no_clearance: rule 2 warning", async () => {
    await start("no_clearance");
    const r = await until("rule 2 warning", STEP_MS, (w) =>
      w.alerts.find((a) => a.status === "active" && a.level === "warning" && a.conflict?.rule === "runway_incursion_no_clearance"));
    return `"${r.v.text}" latencyMs ${r.v.latencyMs} after ${r.s.toFixed(1)} s`;
  });

  await step("(d) visibility: weather caution, banner false", async () => {
    await start("visibility");
    const r = await until("weather caution", STEP_MS, (w) =>
      w.alerts.find((a) => a.status === "active" && a.level === "caution" && a.conflict?.rule === "weather_below_minimums"));
    if (r.v.banner !== false) throw new Error(`weather caution has banner ${r.v.banner}`);
    return `"${r.v.text}" banner false after ${r.s.toFixed(1)} s`;
  });

  await step("(e) incident without: no banner ever", async () => {
    const old = await start("incident", "without");
    const banners = new Set();
    const stop = watch((w) => { for (const a of w.alerts) if (!old.has(a.id) && a.banner) banners.add(`${a.conflict?.rule}: ${a.text}`); });
    // shortcut: watches until 25 s wall (100 sim s) past the crossing call; widen if the scenario's landing moves later
    await until("cross_runway 28L call", STEP_MS, (w) => w.calls.find((c) => c.clearance?.action === "cross_runway" && c.clearance.runway === "28L"));
    await sleep(25000);
    stop();
    if (banners.size) throw new Error(`banner shown: ${[...banners].join(" | ")}`);
    return `no banner; rule 1 alert seen ${world.alerts.some(isRule1)}`;
  });
}

const restore = () => post({ cmd: "scenario", value: "normal" }).then(() => post({ cmd: "speed", value: 1 })).catch((e) => console.log(`restore failed: ${e.message}`));
const done = async (code) => { await restore(); ws.close(); process.exit(code); };
setTimeout(() => { console.log("FAIL overall timeout 4 min"); done(1); }, 240000).unref();
main().then(() => { console.log(failed ? `${failed} FAILED` : "ALL PASS"); return done(failed ? 1 : 0); })
  .catch((e) => { console.log(`FAIL ${e.message}`); return done(1); });
