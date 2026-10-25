// Self-check for the airfield lane: npx tsx src/engine/airfield.check.ts
import type { Call, Clearance, Track, WorldState } from "@/lib/contract";
import { NM, crossing, endOf, offset, runwayOf } from "@/lib/sfo";
import { createAirfield } from "./airfield";
import type { ActiveClearances, Detection } from "./types";

type LonLat = [number, number];
const ok = (cond: unknown, msg: string) => { if (!cond) throw new Error(`FAIL: ${msg}`); console.log(`ok  ${msg}`); };

const T0 = Date.parse("2026-10-25T21:30:00Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const E28L = endOf("28L")!, P = crossing("28L", "P")!;
const onFinal = (nm: number): LonLat => offset(E28L.threshold, (E28L.heading + 180) % 360, nm * NM);
const down28L = (m: number, side = 0): LonLat => offset(offset(E28L.threshold, E28L.heading, m), E28L.heading + 90, side);

const track = (id: string, kind: Track["kind"], [lon, lat]: LonLat, extra: Partial<Track> = {}): Track =>
  ({ t: at(0), id, kind, callsign: id, lon, lat, speed_kt: 0, heading: 0, source: "simulated", ...extra });
const byl = (p: LonLat, extra: Partial<Track> = {}) => track("BYL646", "aircraft", p, { speed_kt: 145, heading: E28L.heading, alt_ft: 400, type: "A320", ...extra });
const rescue = () => track("RESCUE9", "vehicle", offset(P, E28L.heading + 90, 100), { estimated: true, type: "VEH" });

const clr = (callsign: string, action: Clearance["action"], s: number, extra: Partial<Clearance> = {}): Clearance =>
  ({ t: at(s), speaker: action === "readback" ? "pilot" : "tower", callsign, action, confidence: 0.95, ...extra });
const call = (id: string, c: Clearance): Call => ({
  id, t: c.t, endT: c.t, freq: "TWR", speaker: c.speaker, from: c.speaker === "tower" ? "TWR" : c.callsign, to: c.speaker === "tower" ? c.callsign : "TWR",
  transcript: "", source: "scenario", stages: {}, clearance: c, lowConfidence: false, rules: [],
});
function world(s: number, tracks: Track[], calls: Call[], wx: Partial<WorldState["weather"]> = {}): WorldState {
  return {
    clock: { simT: at(s), playing: true, speed: 1, scenario: "incident" },
    config: { arr: ["28L", "28R"], dep: ["1L", "1R"], overridden: false },
    weather: { t: at(s), metar: "KSFO 252130Z 28012KT 10SM BKN020", wind_dir: 280, wind_kt: 12, visibility_sm: 10, ceiling_ft: 2000, source: "recorded", ...wx },
    weatherStatus: { runway: "28L", belowMinimums: false, headwindKt: 0, crosswindKt: 0, minimums: { ceiling_ft: 200, visibility_sm: 0.5 } },
    tracks, strips: [], calls: [...calls].reverse(), alerts: [], caption: null,
    stats: { calls: 0, clearances: 0, lowConfidence: 0, alerts: 0, falseAlarms: 0, medianLatencyMs: null },
    outbox: [], ui: { railOpen: false, threshold: 0.75, agentMode: "mock", network: "offline", micListening: false },
  };
}
/** Apply calls in order, like the engine does for confident calls. */
function setup(calls: Call[]) {
  const af = createAirfield(), active: ActiveClearances = {};
  for (const c of calls) af.applyClearance(active, c.clearance!, c.id);
  return { af, active };
}
const rules = (ds: Detection[], rule: string) => ds.filter((d) => d.conflict.rule === rule);

// 1) crossing while BYL646 holds a landing clearance -> rule 1
const land = call("c1", clr("BYL646", "cleared_to_land", 8, { runway: "28L" }));
const cross = call("c2", clr("RESCUE9", "cross_runway", 30, { runway: "28L", taxiway: "P" }));
{
  const { af, active } = setup([land, cross]);
  const w = world(33, [byl(onFinal(1.3)), rescue()], [land, cross]);
  const [d] = rules(af.evaluate(w, active), "crossing_on_landing_runway");
  ok(d?.key === "crossing_on_landing_runway|28L|BYL646|RESCUE9", "rule 1 fires for a crossing during a landing clearance");
  ok(d.text === "Rescue 9 is crossing runway 28L while Bayline 646 is landing on it.", `rule 1 text: ${d.text}`);
  ok(d.level === "warning" && d.banner && d.triggerCallId === "c2" && d.zoneRunway === "28L" && d.paths.length === 2, "rule 1 warning, banner, trigger = crossing call");
  ok(d.countdown && /^BYL646 at P in \d+ s$/.test(d.countdown.label) && Math.abs(d.countdown.seconds - 45) <= 2, `countdown ${d.countdown?.label}`);
  const r = af.checkCall(cross, w, active);
  ok(r.length === 4 && !r[0].pass && r[1].pass && r[2].pass && r[3].pass, `checkCall: R1 fails (${r[0].why}), R2-4 pass`);
  const strips = af.deriveStrips(w, active);
  const sb = strips.find((s) => s.callsign === "BYL646"), sr = strips.find((s) => s.callsign === "RESCUE9");
  ok(sb?.bay === "arriving" && sb.clearance === "CLRD LAND 28L" && sb.distanceNm === 1.3, "strip: BYL646 arriving, CLRD LAND 28L, 1.3 NM");
  ok(sr?.bay === "holding_short" && sr.clearance === "XING 28L @P" && sr.radioOnly, "strip: RESCUE9 holding short, XING 28L @P, radio only");

  // "with" ending: hold position keeps the alert until BYL646 passes P
  const hold = call("c3", clr("RESCUE9", "stop", 37));
  af.applyClearance(active, hold.clearance!, hold.id);
  ok(rules(af.evaluate(world(38, [byl(onFinal(0.6)), rescue()], [land, cross, hold]), active), "crossing_on_landing_runway")[0]?.key === d.key,
    "after hold position, same key stays until the arrival passes P");
  const past = byl(down28L(1300), { alt_ft: 0, speed_kt: 90 });
  ok(!rules(af.evaluate(world(50, [past, rescue()], [land, cross, hold]), active), "crossing_on_landing_runway").length, "resolves once BYL646 passes P");
}

// 2) the same crossing after the arrival is clear does not fire (3 s out of the zone)
{
  const { af, active } = setup([land]);
  af.evaluate(world(60, [byl(down28L(700), { alt_ft: 0, speed_kt: 20 })], [land]), active); // on the runway, before P
  const off = byl(down28L(700, 250), { alt_ft: 0, speed_kt: 15 });
  af.applyClearance(active, cross.clearance!, cross.id);
  const w1 = world(61, [off, rescue()], [land, cross]);
  ok(rules(af.evaluate(w1, active), "crossing_on_landing_runway").length === 1, "1 s after leaving the zone the arrival is not yet clear");
  const w5 = world(64, [off, rescue()], [land, cross]);
  ok(!rules(af.evaluate(w5, active), "crossing_on_landing_runway").length, "3 s out of the zone: crossing does not fire");
  ok(af.checkCall(cross, w5, active)[0].pass, `checkCall R1 passes: ${af.checkCall(cross, w5, active)[0].why}`);
  const rep = call("c4", clr("BYL646", "clear_of_runway", 65, { runway: "28L" }));
  const { af: af2, active: a2 } = setup([land, rep, cross]);
  ok(!rules(af2.evaluate(world(66, [byl(down28L(700, 50), { alt_ft: 0, speed_kt: 10 }), rescue()], [land, rep, cross]), a2), "crossing_on_landing_runway").length,
    "clear_of_runway report: crossing does not fire");
}

// 3) rule 2: recorded aircraft in a zone with no radio is not armed; simulated vehicle with no clearance fires
{
  const { af, active } = setup([]);
  const ual = track("UAL1", "aircraft", down28L(1200), { source: "recorded", alt_ft: 0, speed_kt: 10 });
  const R1R = runwayOf("1R")!, mid = offset(R1R.ends[0].threshold, R1R.ends[0].heading, 600);
  const ops = track("OPS7", "vehicle", mid, { speed_kt: 25, type: "VEH" });
  const w = world(70, [ual, ops], []);
  const ds = rules(af.evaluate(w, active), "runway_incursion_no_clearance");
  ok(!ds.some((d) => d.conflict.parties.includes("UAL1")), "recorded aircraft with no radio does not fire rule 2");
  ok(ds.length === 1 && ds[0].text === "Ops 7 is on runway 1R with no clearance.", `rule 2 fires for OPS7: ${ds[0]?.text}`);
  const luaw = call("c9", clr("FGX502", "line_up_and_wait", 65, { runway: "1R" }));
  const s2 = setup([luaw]);
  const fgx = track("FGX502", "aircraft", offset(R1R.ends[0].threshold, R1R.ends[0].heading, 50), { alt_ft: 0 });
  const [d2] = rules(s2.af.evaluate(world(71, [fgx, ops], [luaw]), s2.active), "runway_incursion_no_clearance");
  ok(d2?.text === "Ops 7 is on runway 1R with no clearance while Fog Express 502 is lined up on it." && rules([d2], "runway_incursion_no_clearance").length === 1,
    `LUAW aircraft is fine, intruder named with it: ${d2?.text}`);
}

// 4) readback mismatch -> rule 4 caution; a correct readback does not
{
  const ins = call("c5", clr("FGX77", "cross_runway", 80, { runway: "28R", taxiway: "L" }));
  const bad = call("c6", clr("FGX77", "readback", 83, { runway: "28L", taxiway: "L" }));
  const { af, active } = setup([ins, bad]);
  const fgx = track("FGX77", "aircraft", offset(crossing("28R", "L")!, E28L.heading + 90, 120), { type: "B738" });
  const w = world(84, [fgx], [ins, bad]);
  const [d] = rules(af.evaluate(w, active), "readback_mismatch");
  ok(d?.level === "caution" && d.banner && d.text === "Fog Express 77 read back runway 28L, but the instruction was runway 28R.", `rule 4 fires: ${d?.text}`);
  ok(!af.checkCall(bad, w, active)[3].pass, "checkCall R4 fails on the mismatched readback");
  const good = call("c7", clr("FGX77", "readback", 86, { runway: "28R", taxiway: "L" }));
  ok(!rules(af.evaluate(world(87, [fgx], [ins, bad, good]), active), "readback_mismatch").length, "a correct readback clears rule 4");
}

// 5) weather: below minimums is a panel-only caution; a landing clearance escalates it
{
  const { af, active } = setup([land]);
  const fog = { visibility_sm: 0.25, ceiling_ft: 100, metar: "KSFO 252130Z 28008KT 1/4SM FG VV001" };
  const ds = rules(af.evaluate(world(90, [byl(onFinal(3))], [land], fog), active), "weather_below_minimums");
  ok(ds.some((d) => d.level === "caution" && !d.banner) && ds.some((d) => d.level === "warning" && d.banner), "rule 3 caution (no banner) plus escalated warning");
  const ws = af.weatherStatus(world(90, [], [], fog).weather, { arr: ["28L"], dep: ["1R"], overridden: false });
  ok(ws.belowMinimums && ws.runway === "28L" && ws.headwindKt > 0, `weatherStatus below, headwind ${ws.headwindKt} kt, crosswind ${ws.crosswindKt} kt`);
}
console.log("airfield self-check passed");
