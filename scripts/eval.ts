// Headless eval for the eval slide: every scenario through the shipped engine on a virtual clock, mock agent with zero delay.
// Run: npx tsx scripts/eval.ts  (prints a table, writes data/eval/latest.json)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCENARIO_LABEL, ZULU, type Alert, type Call, type ScenarioId } from "../src/lib/contract";
import { createEngine } from "../src/engine/engine";
import { createMockAgent } from "../src/engine/agents";
import { RUNWAYS, inZone, runwayOf } from "../src/lib/sfo";

const TICK_MS = 250; // the engine's tick: at speed 1 each virtual tick is 250 ms of sim time, evaluate() every 4th
const ranAt = new Date().toISOString();

// Virtual time: the engine reads Date.now and ticks on setInterval; the mock agent waits on setTimeout.
// Stubbing those three runs engine.ts unchanged, as fast as the CPU goes. Pipeline stage ms come from performance.now (real).
// Date.now adds real ms elapsed since the tick began: the tick reads it first (sim clock stays exact), the check stage reads it later.
let now = Date.now(), mark = performance.now();
Date.now = () => now + Math.floor(performance.now() - mark);
let tick: () => void = () => { throw new Error("engine did not start its clock"); };
Object.assign(globalThis, {
  setInterval: (fn: () => void) => { tick = fn; return 0; },
  setTimeout: (fn: () => void) => { queueMicrotask(fn); return 0; }, // mock agent delays skipped
});
const flush = () => new Promise<void>((r) => setImmediate(r)); // drains every pipeline and judge microtask chain

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), n = s.length;
  return (s[(n - 1) >> 1] + s[n >> 1]) / 2;
};
const STAGES = ["stt", "parse", "link", "check", "judge"] as const;
const stageMs: Record<(typeof STAGES)[number], number[]> = { stt: [], parse: [], link: [], check: [], judge: [] };

async function run(id: ScenarioId) {
  const engine = createEngine({ agent: createMockAgent(), network: "offline" });
  engine.command({ cmd: "scenario", value: id }); // incident: the engine's default "with" ending
  engine.start();
  const calls = new Map<string, Call>(), alerts = new Map<string, { a: Alert; call?: Call; entry?: string }>();
  const entered = new Map<string, string>(); // `${callsign}|${runwayId}` -> sim time it entered that runway zone
  const t0 = performance.now();
  let w = engine.getWorld();
  const startT = w.clock.simT;
  while (w.clock.playing) {
    const before = w.clock.simT;
    now += TICK_MS;
    mark = performance.now();
    tick();
    await flush();
    w = engine.getWorld();
    if (w.clock.playing && w.clock.simT <= before) throw new Error(`sim clock stuck at ${before}: engine no longer reads Date.now`);
    for (const c of w.calls) calls.set(c.id, c); // world keeps only 40 calls: collect each one while it is there
    for (const t of w.tracks) for (const r of RUNWAYS) { // same zone test as the checker: on the ground, inside the zone
      const k = `${t.callsign}|${r.id}`;
      if ((t.alt_ft ?? 0) <= 100 && inZone([t.lon, t.lat], r.id)) { if (!entered.has(k)) entered.set(k, w.clock.simT); } else entered.delete(k);
    }
    for (const a of w.alerts) if (!alerts.has(a.id)) // as first fired
      alerts.set(a.id, { a, call: calls.get(a.callId ?? ""), entry: entered.get(`${a.conflict.parties[0]}|${runwayOf(a.conflict.runway)?.id}`) });
  }
  for (const c of calls.values()) for (const k of STAGES) { const s = c.stages[k]; if (s) stageMs[k].push(s.ms); }
  const fired = [...alerts.values()];
  return {
    id, label: SCENARIO_LABEL[id],
    simMinutes: Math.round((Date.parse(w.clock.simT) - Date.parse(startT)) / 6000) / 10,
    calls: w.stats.calls, clearances: w.stats.clearances, lowConfidence: w.stats.lowConfidence,
    warnings: fired.filter(({ a }) => a.level === "warning").length,
    cautions: fired.filter(({ a }) => a.level === "caution").length,
    realS: Math.round(performance.now() - t0) / 1000,
    warningDetail: fired.filter(({ a }) => a.level === "warning").map(({ a, call, entry }) => ({
      rule: a.conflict.rule, runway: a.conflict.runway, parties: a.conflict.parties, simT: a.t,
      callEndToDetectS: call ? (Date.parse(a.t) - Date.parse(call.endT)) / 1000 : null, // null: no trigger call (rule 2)
      zoneEntryToDetectS: !call && entry ? (Date.parse(a.t) - Date.parse(entry)) / 1000 : null, // rule 2: from runway zone entry
      countdownS: a.countdown?.seconds ?? null,
    })),
  };
}

async function main() {
  const results = [];
  for (const id of Object.keys(SCENARIO_LABEL) as ScenarioId[]) results.push(await run(id));
  const falseWarningsNormal = results.find((r) => r.id === "normal")!.warnings; // normal traffic has no conflicts by design
  const medianStageMs = Object.fromEntries(STAGES.map((k) => [k, median(stageMs[k])]));

  const row = (cells: unknown[]) => cells.map((c, i) => (i ? String(c).padStart(11) : String(c).padEnd(13))).join("");
  console.log(row(["scenario", "sim min", "calls", "clearances", "low-conf", "warnings", "cautions", "real s"]));
  for (const r of results) console.log(row([r.id, r.simMinutes, r.calls, r.clearances, r.lowConfidence, r.warnings, r.cautions, r.realS]));
  console.log("\nwarnings (sim time; call end, or zone entry if no call, to detection; countdown at fire time)");
  for (const r of results) for (const d of r.warningDetail)
    console.log(`  ${r.id.padEnd(13)}${d.rule.padEnd(31)}${d.runway.padEnd(5)}${d.parties.join(", ").padEnd(18)}${ZULU(d.simT)}  ` +
      `${d.callEndToDetectS !== null ? `+${d.callEndToDetectS.toFixed(2)} s after call` : d.zoneEntryToDetectS !== null ? `+${d.zoneEntryToDetectS.toFixed(2)} s after zone entry` : "-"}` +
      `${d.countdownS === null ? "" : `  countdown ${d.countdownS} s`}`);
  console.log(`\nfalse warnings in normal traffic: ${falseWarningsNormal}`);
  console.log(`median stage ms (real, mock agent, zero delay): ${STAGES.map((k) => `${k} ${medianStageMs[k] ?? "-"}`).join("  ")}`);

  const dir = join(__dirname, "..", "data/eval");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "latest.json"), JSON.stringify({ ranAt, agent: "mock, zero delay", tickMs: TICK_MS, scenarios: results, falseWarningsNormal, medianStageMs }, null, 2) + "\n");
  console.log(`wrote ${join(dir, "latest.json")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
