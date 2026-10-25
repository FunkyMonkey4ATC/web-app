// Traffic simulator: the recorded SFO half hour (looped) plus scenario traffic and scripted radio calls, on one clock.
import type { Action, Iso, ScenarioId, Track, Weather } from "@/lib/contract";
import { SCENARIO_LABEL } from "@/lib/contract";
import type { RawCall, Sim } from "@/engine/types";
import { NM, approachLine, bearingDeg, crossing, distM, endOf, inZone, offset, runwayCoords, runwayOf } from "@/lib/sfo";
import recording from "./sfo-recording.json";

type LonLat = [number, number];
type Row = [string, string, number, number, number, number, number, string, number]; // see recording.fields
const rec = recording as unknown as { startT: Iso; endT: Iso; frames: { t: Iso; tracks: Row[] }[]; metars: { t: Iso; metar: string }[]; audio: string[] };

const KT = 1852 / 3600; // m/s per knot
const T0 = Date.parse(rec.startT);
const REC_S = (Date.parse(rec.endT) - T0) / 1000 || 1;
const secs = (t: Iso) => (Date.parse(t) - T0) / 1000;
const iso = (s: number): Iso => new Date(T0 + s * 1000).toISOString();
const FRAMES = rec.frames.map((f) => ({ s: secs(f.t), byId: new Map(f.tracks.map((r) => [r[0], r])) }));

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const lerpP = (a: LonLat, b: LonLat, f: number): LonLat => [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];
const lerpHdg = (a: number, b: number, f: number) => (a + ((((b - a) % 360) + 540) % 360 - 180) * f + 360) % 360;

function parseMetar(metar: string) {
  const w = metar.match(/\b(\d{3}|VRB)(\d{2,3})(?:G\d{2,3})?KT\b/);
  const v = metar.match(/\s(?:(\d+) )?M?(\d+)(?:\/(\d+))?SM\b/);
  const c = metar.match(/\b(?:BKN|OVC|VV)(\d{3})\b/);
  return {
    metar,
    wind_dir: w && w[1] !== "VRB" ? +w[1] : 0,
    wind_kt: w ? +w[2] : 0,
    visibility_sm: v ? (v[1] ? +v[1] : 0) + (v[3] ? +v[2] / +v[3] : +v[2]) : 10,
    ceiling_ft: c ? +c[1] * 100 : null,
  };
}
const METARS = rec.metars.map((m) => ({ s: secs(m.t), w: { t: m.t, ...parseMetar(m.metar), source: "recorded" } as Weather }));

// ---- Simulated movers: legs of waypoints, constant acceleration between waypoints ----
interface Wp { p: LonLat; kt: number; alt?: number }
interface Leg { at: number; wps: Wp[] }               // starts moving at `at` (s from startT), from wps[0]
interface Mover { callsign: string; kind: Track["kind"]; type: string; estimated?: boolean; from: number; to: number; legs: Leg[] }

const segT = (a: Wp, b: Wp) => (2 * distM(a.p, b.p)) / ((a.kt + b.kt) * KT);
const legEnd = (l: Leg) => l.wps.slice(1).reduce((t, b, i) => t + segT(l.wps[i], b), l.at);

function pose(m: Mover, t: number) {
  let rest = m.legs[0].wps[0], hdg = bearingDeg(rest.p, m.legs[0].wps[1].p);
  for (const leg of m.legs) {
    if (t < leg.at) break;
    let dt = t - leg.at;
    for (let i = 1; i < leg.wps.length; i++) {
      const a = leg.wps[i - 1], b = leg.wps[i], T = segT(a, b);
      hdg = bearingDeg(a.p, b.p);
      if (dt < T) {
        const acc = ((b.kt - a.kt) * KT) / T, f = (a.kt * KT * dt + (acc * dt * dt) / 2) / distM(a.p, b.p);
        return { p: lerpP(a.p, b.p, f), kt: lerp(a.kt, b.kt, dt / T), alt: lerp(a.alt ?? 0, b.alt ?? 0, f), hdg };
      }
      dt -= T;
    }
    rest = leg.wps[leg.wps.length - 1];
  }
  return { p: rest.p, kt: 0, alt: rest.alt ?? 0, hdg };
}

const toward = (a: LonLat, b: LonLat, m: number) => lerpP(a, b, m / distM(a, b));
/** Ground movement along `pts`, from rest to rest, `kt` in between (legs must be > 30 m). */
function drive(pts: LonLat[], kt: number): Wp[] {
  const n = pts.length;
  return [{ p: pts[0], kt: 0 }, { p: toward(pts[0], pts[1], 15), kt }, ...pts.slice(1, -1).map((p) => ({ p, kt })), { p: toward(pts[n - 1], pts[n - 2], 15), kt }, { p: pts[n - 1], kt: 0 }];
}
/** Point `m` metres down runway `end` from its threshold, `side` metres right of the landing direction. */
const rwy = (end: string, m: number, side = 0) => { const e = endOf(end)!; return offset(offset(e.threshold, e.heading, m), e.heading + 90, side); };
/** Point on taxiway `ref`'s crossing of runway `end`, `side` metres right of that end's landing direction. */
const across = (end: string, ref: string, side: number) => offset(crossing(end, ref)!, endOf(end)!.heading + 90, side);
/** Along-runway metres from the `end` threshold. */
const fromEnd = (p: LonLat, end: string) => { const r = runwayOf(end)!, a = runwayCoords(p, r).along; return r.ends[0].name === end ? a : r.lengthM - a; };

function landing(end: string, nm: number, rollout: Wp[]): Wp[] {
  return [{ p: approachLine(end, nm)[0], kt: 145, alt: 50 + nm * 318 }, { p: endOf(end)!.threshold, kt: 145, alt: 50 }, { p: rwy(end, 300), kt: 140 }, ...rollout];
}
/** 28R rollout, exit left at Echo into the gap between the 28s (outside both runway zones). */
function exit28RtoGapE(): Wp[] {
  const c = crossing("28R", "E")!, gap = across("28L", "E", 114);
  return [{ p: rwy("28R", 1700), kt: 40 }, { p: c, kt: 15 }, { p: toward(gap, c, 15), kt: 15 }, { p: gap, kt: 0 }];
}
const lineUp = (end: string): Wp[] => drive([rwy(end, 150, -100), rwy(end, 150), rwy(end, 175)], 10);

/** Recorded traffic on a scenario runway or its extended centerline is hidden so scripted traffic owns it. */
function onRunwayLine(end: string, p: LonLat, alt: number) {
  const r = runwayOf(end)!, { along, off } = runwayCoords(p, r);
  return Math.abs(off) < 150 && along > -8 * NM && along < r.lengthM + 8 * NM && (alt > 0 || inZone(p, end));
}

const VEHICLES = new Set(["RESCUE9", "OPS7"]);
interface Built { calls: RawCall[]; movers: Mover[]; clear: string[]; end?: number; jump?: number; weather?: (s: number) => Weather }

function build(id: ScenarioId, ending: "with" | "without", audio: Set<string>): Built {
  const calls: RawCall[] = [], movers: Mover[] = [], b: Built = { calls, movers, clear: [] };
  const say = (cid: string, at: number, from: string, to: string, text: string, c: { action: Action; runway?: string; taxiway?: string; confidence?: number }, audioId = cid) => {
    const end = at + Math.max(1.5, text.split(/\s+/).length * 0.28);
    const speaker = from === "TWR" ? "tower" : from === "GND" ? "ground" : VEHICLES.has(from) ? "vehicle" : "pilot";
    calls.push({
      id: cid, t: iso(at), endT: iso(end), freq: from === "GND" || to === "GND" ? "GND" : "TWR", speaker, from, to, text, source: "scenario",
      audio: audio.has(audioId) ? `/audio/${audioId}.wav` : undefined,
      scripted: { speaker, callsign: from === "TWR" || from === "GND" ? to : from, confidence: 0.93, ...c },
    });
    return end;
  };

  if (id === "incident") {
    b.clear = ["28L", "1L"];
    const P = crossing("28L", "P")!, side = (m: number) => across("28L", "P", m); // side + = north of 28L
    const L = runwayOf("28L")!.lengthM;
    const byl: Mover = { callsign: "BYL646", kind: "aircraft", type: "A320", from: 0, to: Infinity, legs: [{ at: 0, wps: landing("28L", 6, [
      { p: rwy("28L", L - 400), kt: 60 }, { p: rwy("28L", L - 220), kt: 20 }, { p: rwy("28L", L - 150, -120), kt: 15 }, { p: rwy("28L", L - 150, -150), kt: 0 },
    ]) }] };
    let tP = 0, tClear = 0;
    while (fromEnd(pose(byl, tP).p, "28L") < fromEnd(P, "28L") && tP < 600) tP += 0.1;
    for (tClear = tP; inZone(pose(byl, tClear).p, "28L") && tClear < 900; ) tClear += 0.5;
    movers.push(byl);

    let e = say("inc01", 8, "TWR", "BYL646", "Bayline 646, runway two eight left, cleared to land, wind zero five zero at three.", { action: "cleared_to_land", runway: "28L" });
    say("inc02", e + 0.5, "BYL646", "TWR", "Cleared to land two eight left, Bayline 646.", { action: "readback", runway: "28L" });
    e = say("inc03", 30, "TWR", "FGX211", "Fog Express 211, runway one left, line up and wait.", { action: "line_up_and_wait", runway: "1L" });
    e = say("inc04", e + 0.5, "FGX211", "TWR", "Line up and wait one left, Fog Express 211.", { action: "readback", runway: "1L" });
    movers.push({ callsign: "FGX211", kind: "aircraft", type: "A321", from: 0, to: Infinity, legs: [{ at: e + 1, wps: lineUp("1L") }] });
    e = say("inc05", 60, "GND", "TML88", "Tamal 88, runway one right, taxi via Lima.", { action: "taxi", runway: "1R", taxiway: "L" });
    // what the speech model hears through a stepped-on transmission
    e = say("inc06", e + 0.5, "TML88", "GND", "Runway one ri-- taxi v-- Lima, Tamal ate eight.", { action: "readback", runway: "1R", taxiway: "L", confidence: 0.62 });
    movers.push({ callsign: "TML88", kind: "aircraft", type: "B738", from: 0, to: Infinity, legs: [{ at: e + 1, wps: drive([rwy("1L", 150, -400), rwy("1L", 150, -250)], 15) }] });

    const tx = tP - 20; // NTSB DCA26MA161: crossing clearance about 20 s before the collision
    b.jump = tx - 10;
    b.end = tClear + 15; // replay ends once BYL646 has been off the runway long enough to count as clear
    const x = say("inc07", tx, "TWR", "RESCUE9", "Rescue 9, cross runway two eight left at Papa.", { action: "cross_runway", runway: "28L", taxiway: "P" });
    say("inc08", x + 0.5, "RESCUE9", "TWR", "Cross two eight left at Papa, Rescue 9.", { action: "readback", runway: "28L", taxiway: "P" });
    if (ending === "with") say("inc09", x + 5, "TWR", "RESCUE9", "Rescue 9, hold position.", { action: "stop" });
    // "with": rolls a few metres and stops at the hold line, outside the zone; "without": drives across in front of BYL646
    const truck: Wp[] = ending === "with" ? [{ p: side(-100), kt: 0 }, { p: side(-91), kt: 8 }, { p: side(-87), kt: 0 }] : drive([side(-100), side(100)], 15);
    movers.push({ callsign: "RESCUE9", kind: "vehicle", type: "ARFF", estimated: true, from: 0, to: Infinity, legs: [{ at: x + 0.5, wps: truck }] });
  }

  if (id === "no_clearance") {
    b.clear = ["1R"];
    let e = say("nc01", 4, "TWR", "FGX502", "Fog Express 502, runway one right, line up and wait.", { action: "line_up_and_wait", runway: "1R" });
    e = say("nc02", e + 0.5, "FGX502", "TWR", "Line up and wait one right, Fog Express 502.", { action: "readback", runway: "1R" });
    movers.push({ callsign: "FGX502", kind: "aircraft", type: "A320", from: 0, to: Infinity, legs: [{ at: e + 1, wps: lineUp("1R") }] });
    // GPS-equipped ops truck crosses 1R at Foxtrot with nothing heard on frequency
    movers.push({ callsign: "OPS7", kind: "vehicle", type: "VEH", from: 0, to: Infinity, legs: [{ at: 40, wps: drive([across("1R", "F", 180), across("1R", "F", -115)], 15) }] });
  }

  if (id === "visibility") {
    b.clear = ["28R"];
    const steps: [number, string][] = [
      [0, "28012KT 10SM BKN020 18/12"], [20, "28011KT 5SM BR BKN012 17/13"], [35, "28010KT 2SM BR OVC006 16/14"],
      [50, "28009KT 1SM BR OVC003 16/15"], [65, "28008KT 1/2SM FG VV002 15/15"], [80, "28008KT 1/4SM FG VV001 15/15"],
    ];
    const wx = steps.map(([at, body], i) => {
      const t = iso(at);
      return { at, w: { t, ...parseMetar(`${i ? "SPECI" : "METAR"} KSFO ${t.slice(8, 10)}${t.slice(11, 13)}${t.slice(14, 16)}Z ${body} A3005`), source: "simulated" } as Weather };
    });
    b.weather = (s) => (wx.findLast((x) => x.at <= s) ?? wx[0]).w;
    movers.push({ callsign: "TML412", kind: "aircraft", type: "A320", from: 0, to: Infinity, legs: [{ at: 0, wps: landing("28R", 5, exit28RtoGapE()) }] });
    // landing clearance after visibility is below minimums: rule 3 escalates from the weather panel to a banner
    const e = say("vis01", 95, "TWR", "TML412", "Tamal 412, runway two eight right, cleared to land, wind two eight zero at eight.", { action: "cleared_to_land", runway: "28R" });
    say("vis02", e + 0.5, "TML412", "TWR", "Cleared to land two eight right, Tamal 412.", { action: "readback", runway: "28R" });
  }

  if (id === "normal") {
    // a 300 s loop of correct operations repeated over the recording; one readback mismatch (rule 4 caution) per loop
    for (let k = 0, c = 0; c + 330 <= REC_S; k++, c += 300) {
      const n = (i: number, at: number, from: string, to: string, text: string, cl: Parameters<typeof say>[5]) => say(`nrm${String(i).padStart(2, "0")}-${k}`, at, from, to, text, cl, `nrm${String(i).padStart(2, "0")}`);

      let e = n(1, c + 2, "GND", "TML88", "Tamal 88, runway one left, taxi via Alpha.", { action: "taxi", runway: "1L", taxiway: "A" });
      e = n(2, e + 0.5, "TML88", "GND", "Runway one left, taxi via Alpha, Tamal 88.", { action: "readback", runway: "1L", taxiway: "A" });
      const taxi: Leg = { at: e + 1, wps: drive([rwy("1L", 150, -400), rwy("1L", 150, -100)], 15) };

      e = n(3, c + 20, "TWR", "FGX77", "Fog Express 77, cross runway two eight right at Lima.", { action: "cross_runway", runway: "28R", taxiway: "L" });
      e = n(4, e + 0.5, "FGX77", "TWR", "Crossing two eight left at Lima, Fog Express 77.", { action: "readback", runway: "28L", taxiway: "L" });
      const cross: Leg = { at: e + 1, wps: drive([across("28R", "L", -114), across("28R", "L", 100)], 15) };

      e = n(5, c + 60, "TWR", "TML88", "Tamal 88, runway one left, line up and wait.", { action: "line_up_and_wait", runway: "1L" });
      e = n(6, e + 0.5, "TML88", "TWR", "Line up and wait one left, Tamal 88.", { action: "readback", runway: "1L" });
      const luaw: Leg = { at: e + 1, wps: lineUp("1L") };

      // ground's taxi instruction replaces FGX77's crossing clearance once it is across
      e = n(7, c + 70, "GND", "FGX77", "Fog Express 77, taxi to the ramp via Alpha.", { action: "taxi", taxiway: "A" });
      e = n(8, e + 0.5, "FGX77", "GND", "Taxi to the ramp via Alpha, Fog Express 77.", { action: "readback", taxiway: "A" });
      const ramp: Leg = { at: e + 1, wps: drive([across("28R", "L", 100), offset(across("28R", "L", 100), endOf("10L")!.heading, 250)], 15) };
      movers.push({ callsign: "FGX77", kind: "aircraft", type: "E75L", from: c, to: legEnd(ramp) + 10, legs: [cross, ramp] });

      e = n(9, c + 100, "TWR", "TML88", "Tamal 88, runway one left, wind zero five zero at three, cleared for takeoff.", { action: "cleared_for_takeoff", runway: "1L" });
      e = n(10, e + 0.5, "TML88", "TWR", "Cleared for takeoff one left, Tamal 88.", { action: "readback", runway: "1L" });
      const takeoff: Leg = { at: e + 1, wps: [{ p: rwy("1L", 175), kt: 0 }, { p: rwy("1L", 1650), kt: 145 }, { p: rwy("1L", 1650 + 3 * NM), kt: 180, alt: 2500 }] };
      movers.push({ callsign: "TML88", kind: "aircraft", type: "B738", from: c, to: legEnd(takeoff), legs: [taxi, luaw, takeoff] });

      e = n(11, c + 160, "TWR", "BYL214", "Bayline 214, runway two eight right, cleared to land, wind zero five zero at three.", { action: "cleared_to_land", runway: "28R" });
      n(12, e + 0.5, "BYL214", "TWR", "Cleared to land two eight right, Bayline 214.", { action: "readback", runway: "28R" });
      e = n(13, c + 265, "TWR", "BYL214", "Bayline 214, cross runway two eight left at Echo.", { action: "cross_runway", runway: "28L", taxiway: "E" });
      e = n(14, e + 0.5, "BYL214", "TWR", "Cross two eight left at Echo, Bayline 214.", { action: "readback", runway: "28L", taxiway: "E" });
      movers.push({ callsign: "BYL214", kind: "aircraft", type: "A321", from: c + 120, to: c + 330, legs: [
        { at: c + 120, wps: landing("28R", 3, exit28RtoGapE()) },
        { at: e + 1, wps: drive([across("28L", "E", 114), across("28L", "E", -100)], 15) },
      ] });
    }
  }

  calls.sort((x, y) => x.t.localeCompare(y.t));
  return b;
}

/** `audioIds`: call ids with a public/audio/<id>.wav (the build script lists them at build time). */
export function createSim(audioIds: string[] = rec.audio): Sim {
  const audio = new Set(audioIds);
  let scenario: ScenarioId = "normal";
  let s = build(scenario, "with", audio);

  return {
    load(id, ending = "with") { scenario = id; s = build(id, ending, audio); },
    startT: () => rec.startT,
    endT: () => (s.end != null ? iso(s.end) : rec.endT),
    frame(simT) {
      const t = secs(simT), tracks: Track[] = [];
      for (const m of s.movers) {
        if (t < m.from || t > m.to) continue;
        const q = pose(m, t);
        tracks.push({
          t: simT, id: `sim-${m.callsign}`, kind: m.kind, callsign: m.callsign, lat: q.p[1], lon: q.p[0], speed_kt: Math.round(q.kt),
          heading: Math.round(q.hdg), source: "simulated", type: m.type, alt_ft: Math.round(q.alt), ...(m.estimated && { estimated: true }),
        });
      }
      const r = ((t % REC_S) + REC_S) % REC_S; // the recording loops underneath every scenario
      const i = Math.max(0, FRAMES.findLastIndex((f) => f.s <= r)), A = FRAMES[i], B = FRAMES[i + 1];
      const f = B ? (r - A.s) / (B.s - A.s) : 0;
      for (const [id, a] of A.byId) {
        const z = B?.byId.get(id) ?? a;
        const p: LonLat = [lerp(a[3], z[3], f), lerp(a[2], z[2], f)], alt = lerp(a[4], z[4], f);
        if (s.clear.some((end) => onRunwayLine(end, p, alt))) continue;
        tracks.push({
          t: simT, id, kind: a[8] ? "vehicle" : "aircraft", callsign: a[1], lat: p[1], lon: p[0], speed_kt: Math.round(lerp(a[5], z[5], f)),
          heading: Math.round(lerpHdg(a[6], z[6], f)), source: "recorded", type: a[7] || undefined, alt_ft: Math.round(alt),
        });
      }
      return { tracks, weather: s.weather?.(t) ?? (METARS.findLast((m) => m.s <= r) ?? METARS[0]).w };
    },
    callsBetween(fromT, toT) {
      const a = Date.parse(fromT), z = Date.parse(toT);
      return s.calls.filter((c) => { const t = Date.parse(c.t); return t > a && t <= z; });
    },
    jumpTarget: () => (s.jump != null ? iso(s.jump) : null),
    config: () => ({ arr: ["28L", "28R"], dep: ["1L", "1R"] }),
    label: () => SCENARIO_LABEL[scenario],
  };
}
