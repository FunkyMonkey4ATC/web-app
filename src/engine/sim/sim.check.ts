// Self-check for the simulator: npx tsx src/engine/sim/sim.check.ts
import type { ScenarioId, Track } from "@/lib/contract";
import { RUNWAYS, crossing, inZone, runwayCoords, runwayOf } from "@/lib/sfo";
import { createSim } from "./index";

const ok = (cond: unknown, msg: string) => { if (!cond) throw new Error(msg); };
const sim = createSim();
const rid = (name?: string) => (name ? runwayOf(name)?.id : undefined);
const fromEnd = (tr: Track, end: string) => { const r = runwayOf(end)!, a = runwayCoords([tr.lon, tr.lat], r).along; return r.ends[0].name === end ? a : r.lengthM - a; };

function run(id: ScenarioId, ending?: "with" | "without") {
  sim.load(id, ending);
  const t0 = Date.parse(sim.startT()), t1 = Math.min(Date.parse(sim.endT()), t0 + 900_000);
  const calls = sim.callsBetween(new Date(t0 - 1).toISOString(), sim.endT());
  const steps = [];
  for (let t = t0; t <= t1; t += 500) steps.push({ t, ...sim.frame(new Date(t).toISOString()) });
  ok(steps.every((s) => s.tracks.some((x) => x.source === "recorded")), `${id}: recorded traffic missing`);
  ok(new Set(calls.map((c) => c.id)).size === calls.length, `${id}: duplicate call ids`);
  for (const f of ["TWR", "GND"]) {
    const fc = calls.filter((c) => c.freq === f);
    fc.slice(1).forEach((c, i) => ok(Date.parse(c.t) >= Date.parse(fc[i].endT), `${id}: ${fc[i].id} and ${c.id} overlap on ${f}`));
  }
  const heardBy = (callsign: string, t: number) => calls.filter((c) => Date.parse(c.endT) <= t && c.scripted?.callsign === callsign && (c.speaker === "tower" || c.speaker === "ground"));

  // rule 2 proxy: a simulated track on the ground inside a runway zone needs a heard runway instruction for that runway,
  // or for a runway whose zone it is also in (SFO's runways intersect)
  const incursions = new Set<string>();
  for (const s of steps) for (const tr of s.tracks) {
    if (tr.source !== "simulated" || (tr.alt_ft ?? 0) > 100) continue;
    const p: [number, number] = [tr.lon, tr.lat];
    const cleared = heardBy(tr.callsign, s.t).filter((c) => c.scripted!.action !== "taxi" && c.scripted!.action !== "stop").map((c) => rid(c.scripted!.runway));
    for (const r of RUNWAYS) if (inZone(p, r.id) && !cleared.some((c) => c && inZone(p, c))) incursions.add(`${tr.callsign} ${r.id}`);
  }
  // rule 1 proxy: crossing/takeoff instruction while a landing aircraft on that runway is not yet clear (outside the zone 3 s after being in it)
  const conflicts: string[] = [];
  for (const c of calls) {
    if (c.scripted?.action !== "cross_runway" && c.scripted?.action !== "cleared_for_takeoff") continue;
    const R = rid(c.scripted.runway)!, tc = Date.parse(c.endT);
    for (const l of calls) {
      if (l.scripted?.action !== "cleared_to_land" || rid(l.scripted.runway) !== R || Date.parse(l.endT) > tc) continue;
      const inside = steps.filter((s) => s.t <= tc && s.tracks.some((x) => x.callsign === l.scripted!.callsign && inZone([x.lon, x.lat], R)));
      if (!inside.length || tc - inside[inside.length - 1].t < 3000) conflicts.push(`${c.id} ${R} ${l.scripted.callsign}`);
    }
  }
  return { calls, steps, incursions: [...incursions], conflicts };
}

for (const ending of ["with", "without"] as const) {
  const { calls, steps, incursions, conflicts } = run("incident", ending);
  const x = calls.find((c) => c.id === "inc07")!;
  ok(x.scripted?.action === "cross_runway" && x.scripted.runway === "28L" && x.scripted.taxiway === "P" && x.scripted.callsign === "RESCUE9", "crossing call");
  ok(sim.jumpTarget("before_crossing") === new Date(Date.parse(x.t) - 10_000).toISOString(), "jump target is 10 s before the crossing call");
  const atP = steps.find((s) => { const b = s.tracks.find((tr) => tr.callsign === "BYL646"); return b && fromEnd(b, "28L") >= fromEnd({ lon: crossing("28L", "P")![0], lat: crossing("28L", "P")![1] } as Track, "28L"); })!;
  const lead = (atP.t - Date.parse(x.t)) / 1000;
  ok(Math.abs(lead - 20) <= 1, `BYL646 reaches P ${lead} s after the crossing call`);
  const b = atP.tracks.find((tr) => tr.callsign === "BYL646")!;
  const offs = steps.map((s) => s.tracks.find((tr) => tr.callsign === "RESCUE9")!).map((tr) => Math.abs(runwayCoords([tr.lon, tr.lat], runwayOf("28L")!).off));
  const truckAtP = Math.abs(runwayCoords([atP.tracks.find((tr) => tr.callsign === "RESCUE9")!.lon, atP.tracks.find((tr) => tr.callsign === "RESCUE9")!.lat], runwayOf("28L")!).off);
  ok(steps.every((s) => s.tracks.find((tr) => tr.callsign === "RESCUE9")?.estimated), "RESCUE9 is radio-only (EST)");
  if (ending === "with") {
    ok(calls.some((c) => c.id === "inc09" && c.scripted?.action === "stop"), "hold position call");
    ok(Math.min(...offs) > 85, "with: RESCUE9 stops at the hold line, outside the zone");
  } else {
    ok(!calls.some((c) => c.id === "inc09"), "without: no hold call");
    ok(truckAtP < 30.5, `without: RESCUE9 on the runway when BYL646 reaches P (${truckAtP.toFixed(0)} m off centerline)`);
  }
  ok(incursions.length === 0, `incident incursions ${incursions}`);
  ok(conflicts.length === 1 && conflicts[0] === "inc07 10R/28L BYL646", `incident rule 1 should fire once on inc07: ${conflicts}`);
  ok(calls.some((c) => (c.scripted?.confidence ?? 1) < 0.75), "a low-confidence call");
  console.log(`incident/${ending}: crossing ${x.t.slice(11, 19)}Z, BYL646 at P ${lead.toFixed(1)} s later at ${b.speed_kt} kt, truck ${truckAtP.toFixed(0)} m off centerline, ${calls.length} calls`);
}

{
  const { steps, incursions, conflicts } = run("no_clearance");
  ok(incursions.length === 1 && incursions[0] === "OPS7 1R/19L", `no_clearance incursions ${incursions}`);
  ok(conflicts.length === 0, `no_clearance conflicts ${conflicts}`);
  const enter = steps.find((s) => s.tracks.some((tr) => tr.callsign === "OPS7" && inZone([tr.lon, tr.lat], "1R")))!;
  const fgx = enter.tracks.find((tr) => tr.callsign === "FGX502")!;
  ok(inZone([fgx.lon, fgx.lat], "1R") && fgx.speed_kt === 0, "FGX502 lined up and waiting when OPS7 enters");
  console.log(`no_clearance: OPS7 enters 1R at s+${(enter.t - Date.parse(sim.startT())) / 1000}`);
}

{
  const { calls, steps, incursions, conflicts } = run("visibility");
  ok(incursions.length === 0 && conflicts.length === 0, `visibility ${incursions} ${conflicts}`);
  const w0 = steps[0].weather, land = calls.find((c) => c.scripted?.action === "cleared_to_land")!;
  const wl = steps.find((s) => s.t >= Date.parse(land.endT))!.weather;
  ok(w0.visibility_sm === 10 && w0.ceiling_ft === 2000 && w0.wind_dir === 280 && w0.wind_kt === 12 && w0.source === "simulated", `start weather ${JSON.stringify(w0)}`);
  ok(wl.visibility_sm === 0.25 && wl.ceiling_ft === 100, `landing clearance weather ${JSON.stringify(wl)}`);
  console.log(`visibility: ${w0.metar} -> ${wl.metar}`);
}

{
  const { calls, steps, incursions, conflicts } = run("normal");
  ok(incursions.length === 0 && conflicts.length === 0, `normal must be quiet: ${incursions} ${conflicts}`);
  const xr = calls.find((c) => c.id === "nrm03-0")!, rb = calls.find((c) => c.id === "nrm04-0")!;
  ok(xr.scripted?.runway === "28R" && rb.scripted?.runway === "28L", "one readback mismatch per loop");
  const w = steps[0].weather;
  ok(w.source === "recorded" && w.metar.includes("KSFO"), "recorded METAR");
  console.log(`normal: ${calls.length} calls over ${steps.length / 2} s, ${steps[0].tracks.filter((t) => t.source === "recorded").length} recorded tracks at start, weather ${w.metar.slice(0, 40)}`);
}
console.log("sim self-check ok");
