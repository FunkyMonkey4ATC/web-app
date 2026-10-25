// Self-check: npx tsx src/engine/parser.check.ts
import type { Clearance, Track } from "@/lib/contract";
import { parseText } from "./parser";
import { createHttpAgent, createMockAgent } from "./agents";
import { runCall } from "./pipeline";

type Want = Pick<Clearance, "callsign" | "action" | "runway" | "taxiway"> & { low?: boolean };
const T = "2026-10-25T21:30:00.000Z";
const CASES: [Clearance["speaker"], string, Want][] = [
  // incident
  ["tower", "Bayline 646, runway two eight left, cleared to land, wind two eight zero at one two.", { callsign: "BYL646", action: "cleared_to_land", runway: "28L" }],
  ["pilot", "Cleared to land two eight left, Bayline 646.", { callsign: "BYL646", action: "readback", runway: "28L" }],
  ["tower", "Fog Express two one one, runway one left, line up and wait.", { callsign: "FGX211", action: "line_up_and_wait", runway: "1L" }],
  ["pilot", "Line up and wait one left, Fog Express two one one.", { callsign: "FGX211", action: "readback", runway: "1L" }],
  ["ground", "Tamal eight eight, taxi to runway one right via Lima.", { callsign: "TML88", action: "taxi", runway: "1R", taxiway: "L" }],
  ["ground", "Tamal eight eight, taxi to runway one ri... via Lima.", { callsign: "TML88", action: "taxi", taxiway: "L", low: true }], // garbled
  ["tower", "Rescue 9, cross runway two eight left at Papa.", { callsign: "RESCUE9", action: "cross_runway", runway: "28L", taxiway: "P" }],
  ["vehicle", "Cross two eight left at Papa, Rescue 9.", { callsign: "RESCUE9", action: "readback", runway: "28L", taxiway: "P" }],
  ["tower", "Rescue 9, hold position.", { callsign: "RESCUE9", action: "stop" }],
  ["vehicle", "Holding position, Rescue nine.", { callsign: "RESCUE9", action: "readback" }],
  // no_clearance
  ["tower", "Fog Express five zero two, runway one right, line up and wait.", { callsign: "FGX502", action: "line_up_and_wait", runway: "1R" }],
  ["pilot", "Lining up and waiting runway one right, Fog Express five zero two.", { callsign: "FGX502", action: "readback", runway: "1R" }],
  ["ground", "Ops 7, taxi via Alpha.", { callsign: "OPS7", action: "taxi", taxiway: "A" }],
  // normal
  ["tower", "Bayline three one two, runway one left, cleared for takeoff.", { callsign: "BYL312", action: "cleared_for_takeoff", runway: "1L" }],
  ["tower", "United four five six, runway two eight right, cleared to land.", { callsign: "UAL456", action: "cleared_to_land", runway: "28R" }],
  ["ground", "Tamal one niner, hold short of runway two eight left.", { callsign: "TML19", action: "hold_short", runway: "28L" }],
  ["tower", "Fog Express 77, cross runway two eight right at Lima.", { callsign: "FGX77", action: "cross_runway", runway: "28R", taxiway: "L" }],
  ["pilot", "Crossing two eight left at Lima, Fog Express 77.", { callsign: "FGX77", action: "readback", runway: "28L", taxiway: "L" }],
  ["pilot", "Bayline 646, clear of runway two eight left at Papa.", { callsign: "BYL646", action: "clear_of_runway", runway: "28L", taxiway: "P" }],
  ["tower", "Skywest five four two one, cross runway two eight right, correction, two eight left at Mike.", { callsign: "SKW5421", action: "cross_runway", runway: "28L", taxiway: "M" }],
  ["ground", "Delta niner zero one, taxi to runway one left via Delta.", { callsign: "DAL901", action: "taxi", runway: "1L", taxiway: "D" }],
  ["tower", "American two two, Alaska three one, Southwest one zero, traffic.", { callsign: "AAL22", action: "taxi" }], // no instruction: expect null
];

const fails: string[] = [];
for (const [speaker, text, want] of CASES) {
  const got = parseText(text, { t: T, speaker });
  if (text.endsWith("traffic.")) { if (got) fails.push(`expected null: ${text}`); continue; }
  const keys = ["callsign", "action", "runway", "taxiway"] as const;
  const bad = !got || keys.some((k) => got[k] !== want[k]) || (got.confidence < 0.75) !== !!want.low;
  if (bad) fails.push(`${text}\n   want ${JSON.stringify(want)}\n   got  ${JSON.stringify(got)}`);
}

// pipeline end to end with the mock agent, plus the http agent falling back to the mock when nothing listens
const rescue: Track = { t: T, id: "sim-RESCUE9", kind: "vehicle", callsign: "RESCUE9", lat: 37.61, lon: -122.36, speed_kt: 0, heading: 0, source: "simulated", estimated: true };
const raw = { id: "c1", t: T, endT: T, freq: "TWR" as const, speaker: "tower" as const, from: "TWR", to: "RESCUE9", text: "Rescue 9, cross runway two eight left at Papa.", source: "scenario" as const };
void (async () => { // package is CommonJS, so no top-level await
let updates = 0;
for (const agent of [createMockAgent(), createHttpAgent({ baseUrl: "http://127.0.0.1:9" })]) {
  const c = await runCall(raw, { agent, tracks: [rescue], threshold: 0.75, onUpdate: () => updates++ });
  if (c.clearance?.action !== "cross_runway" || c.linkedTrackId !== "sim-RESCUE9" || c.linkNote !== "radio only, estimated at P hold-short") fails.push(`runCall ${agent.mode}: ${JSON.stringify(c)}`);
  if (!(c.stages.stt!.ms >= 350 && c.stages.parse!.ms >= 80)) fails.push(`runCall ${agent.mode} stage ms: ${JSON.stringify(c.stages)}`);
}
if (updates !== 6) fails.push(`onUpdate calls: ${updates}`);
const j = await createMockAgent().judge({ t: T, rule: "crossing_on_landing_runway", runway: "28L", parties: ["BYL646", "RESCUE9"], evidence: ["c1"], severity_hint: "high" }, { alertId: "a1", text: "", evidence: [] });
if (j.severity !== "high" || j.outbox !== "mock" || j.reasoning.split(". ").length !== 2) fails.push(`judge: ${JSON.stringify(j)}`);

if (fails.length) throw new Error(`${fails.length} failed:\n` + fails.join("\n"));
console.log(`parser.check ok: ${CASES.length} lines, pipeline mock + http fallback, judge`);
})();
