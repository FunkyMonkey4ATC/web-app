// Airfield logic: standing clearances, checker rules 1-4, strips and weather status. Isomorphic: no Node-only imports.
import { BAY_ORDER, type Bay, type Clearance, type Strip, type Track, type Weather, type WorldState } from "@/lib/contract";
import {
  FEATURES, NM, RUNWAYS, ZONE_HALF_WIDTH_M, bearingDeg, crossing, distM, endOf, inZone, offset, runwayCoords, runwayOf, toThresholdNm,
  windComponents, type Runway,
} from "@/lib/sfo";
import type { ActiveClearances, Airfield, CreateAirfield, Detection } from "./types";

type LonLat = [number, number];
type Entry = ActiveClearances[string];
type Found = { d?: Detection; why: string };
type ArrState = "none" | "passed" | "on" | "final" | "far" | "clear";

const MINIMUMS = { ceiling_ft: 200, visibility_sm: 0.5 }; // demo values (ILS CAT I)
const RULES = ["crossing_on_landing_runway", "runway_incursion_no_clearance", "weather_below_minimums", "readback_mismatch"] as const;
const ENTERS = ["cleared_to_land", "cleared_for_takeoff", "line_up_and_wait", "cross_runway"]; // clearances that put you on a runway
const R1: Record<string, [string, string]> = { // rule 1 crosser actions: [alert verb, detail word]
  cross_runway: ["crossing", "crossing"],
  cleared_for_takeoff: ["cleared for takeoff on", "takeoff"],
  line_up_and_wait: ["lining up on", "line-up"],
};
const ON_IT: Record<string, string> = { cleared_to_land: "landing on", cleared_for_takeoff: "taking off from", line_up_and_wait: "lined up on", cross_runway: "crossing" };
const SPOKEN: Record<string, string> = {
  BYL: "Bayline", FGX: "Fog Express", TML: "Tamal", RESCUE: "Rescue", OPS: "Ops",
  UAL: "United", AAL: "American", DAL: "Delta", ASA: "Alaska", SWA: "Southwest", SKW: "SkyWest", JBU: "JetBlue", HAL: "Hawaiian", ACA: "Air Canada",
};
const APRONS = FEATURES.filter((f) => f.properties.aeroway === "apron" && f.geometry.type === "Polygon")
  .map((f) => ({ name: f.properties.name ?? "", ring: (f.geometry.coordinates as LonLat[][])[0] }));

export const spoken = (cs: string) => { const m = cs.match(/^([A-Z]+)(\d\w*)$/); return m && SPOKEN[m[1]] ? `${SPOKEN[m[1]]} ${m[2]}` : cs; };
const pos = (t: Track): LonLat => [t.lon, t.lat];
const rid = (name?: string) => (name ? runwayOf(name)?.id : undefined);
const angle = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
const zonesOf = (t: Track) => ((t.alt_ft ?? 0) > 100 ? [] : RUNWAYS.filter((r) => inZone(pos(t), r.id)));
const trackOf = (w: WorldState, cs: string) => w.tracks.find((t) => t.callsign === cs);
const tOf = (w: WorldState, callId: string) => w.calls.find((c) => c.id === callId)?.t ?? "";
const allows = (e: Entry | undefined, runwayId: string) => !!e && ENTERS.includes(e.clearance.action) && rid(e.clearance.runway) === runwayId;
const evidence = (...es: Entry[]) => es.flatMap((e) => (e.clearance.audio ? [e.callId, e.clearance.audio] : [e.callId]));
const below = (w: Weather) => w.visibility_sm < MINIMUMS.visibility_sm || (w.ceiling_ft !== null && w.ceiling_ft < MINIMUMS.ceiling_ft);
const wx = (w: Weather) => `visibility ${w.visibility_sm} SM, ceiling ${w.ceiling_ft === null ? "none" : `${w.ceiling_ft} ft`}`;
const runwayName = (w: WorldState, r: Runway) => r.ends.find((e) => w.config.arr.includes(e.name) || w.config.dep.includes(e.name))?.name ?? r.id;
/** A low-confidence instruction to `cs` heard in (from, to): what it said is unknown, so a readback can't be compared. */
const unsure = (w: WorldState, cs: string, from: string, to: string) =>
  w.calls.some((c) => c.lowConfidence && c.clearance && c.clearance.action !== "readback" && c.clearance.callsign === cs && c.t > from && c.t < to);
const nearRunway = (p: LonLat) =>
  RUNWAYS.some((r) => { const { along, off } = runwayCoords(p, r); return Math.abs(off) < 200 && along > -200 && along < r.lengthM + 200; });

/** Metres along the runway in the direction of travel from `end` (negative = before the threshold). */
function along(p: LonLat, end: string) {
  const r = runwayOf(end)!, a = runwayCoords(p, r).along;
  return r.ends[0].name === end ? a : r.lengthM - a;
}
function inRing([x, y]: LonLat, ring: LonLat[]) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function shorthand(c: Clearance): string {
  const r = c.runway ?? "";
  switch (c.action) {
    case "cleared_to_land": return `CLRD LAND ${r}`;
    case "cleared_for_takeoff": return `CLRD TKOF ${r}`;
    case "line_up_and_wait": return `LUAW ${r}`;
    case "cross_runway": return `XING ${r}${c.taxiway ? ` @${c.taxiway}` : ""}`;
    case "hold_short": return `H/S ${r}`;
    case "taxi": return ["TAXI", c.taxiway, r && `→ ${r}`].filter(Boolean).join(" ");
    case "stop": return "HOLD POSN";
    case "clear_of_runway": return `CLR OF ${r}`;
    default: return `RDBK ${r}`;
  }
}

/** Readback runway/taxiway that differ from the instruction: [heard, said], or null. Fields missing on either side don't count. */
function mismatch(rb: Clearance, ins: Clearance): [string, string] | null {
  const r = !!rb.runway && !!ins.runway && rb.runway !== ins.runway;
  const x = !!rb.taxiway && !!ins.taxiway && rb.taxiway !== ins.taxiway;
  const say = (c: Clearance) => [r && `runway ${c.runway}`, x && `taxiway ${c.taxiway}`].filter(Boolean).join(" at ");
  return r || x ? [say(rb), say(ins)] : null;
}

/** The ARR end this airborne track is approaching, if any. */
function approachEnd(w: WorldState, t: Track, c?: Clearance): string | undefined {
  if (c?.action === "cleared_to_land" && endOf(c.runway ?? "")) return along(pos(t), c.runway!) < 0 ? c.runway : undefined;
  const alt = t.alt_ft ?? 0;
  if (alt <= 100 || alt > 5000) return undefined;
  return w.config.arr.find((n) => { const e = endOf(n); return e && along(pos(t), n) < 0 && toThresholdNm(pos(t), n) <= 12 && angle(t.heading, e.heading) < 30; });
}

function bayOf(w: WorldState, t: Track, c?: Clearance): Bay {
  if (zonesOf(t).length) return "on_runway";
  if (approachEnd(w, t, c)) return "arriving";
  if ((t.alt_ft ?? 0) > 100) return "departed";
  const p = pos(t), a = c?.action;
  if (t.speed_kt < 3 && APRONS.some((ap) => inRing(p, ap.ring))) return "at_gate";
  if (t.speed_kt < 3 && (a === "hold_short" || nearRunway(p))) return "holding_short";
  if (a === "cleared_for_takeoff" || a === "line_up_and_wait" || a === "hold_short" || (a === "taxi" && c!.runway)) return "taxi_out";
  if (a === "taxi" || a === "cleared_to_land" || a === "clear_of_runway") return "taxi_in";
  const dep = endOf(w.config.dep[0] ?? "");
  return dep && angle(t.heading, bearingDeg(p, dep.threshold)) < 90 ? "taxi_out" : "taxi_in";
}

export const createAirfield: CreateAirfield = () => {
  // Memory between ticks, dropped when the sim clock goes back (restart, scenario change).
  const fresh = () => ({
    lastMs: -Infinity,
    lastInZone: new Map<string, number>(),      // `${trackId}|${runwayId}` -> sim ms last seen inside
    inside: new Set<string>(),                  // `${trackId}|${runwayId}` entered with a clearance: allowed until it leaves
    entered: new Set<string>(),                 // callIds of crossing/takeoff clearances whose track has been in the zone
    latched: new Map<string, [Entry, Entry]>(), // firing rule 1 pairs [crosser, arrival], kept through "hold position"
    heard: new Set<string>(),                   // callsigns heard on frequency: rule 2 stays armed after their calls scroll out of w.calls
  });
  let m = fresh();

  function arrival(w: WorldState, land: Entry, x: LonLat | null, xName: string): { state: ArrState; why: string; t?: Track; s: number } {
    const { callsign, runway } = land.clearance, end = runway!, name = spoken(callsign), t = trackOf(w, callsign);
    if (!t) return { state: "none", why: `no position for ${name}`, s: NaN };
    const s = along(pos(t), end), res = (state: ArrState, why: string) => ({ state, why, t, s });
    if (x && s > along(x, end)) return res("passed", `${name} has passed ${xName}`);
    const seen = m.lastInZone.get(`${t.id}|${rid(end)}`) ?? -Infinity;
    if (zonesOf(t).some((r) => r.id === rid(end)) || Date.parse(w.clock.simT) - seen < 3000) return res("on", `${name} is on ${end}`);
    if (s >= 0) return res("clear", `${name} is clear of ${end}`);
    const nm = toThresholdNm(pos(t), end).toFixed(1);
    return Number(nm) <= 5 ? res("final", `${name} is cleared to land ${end}, ${nm} NM out`) : res("far", `${name} is ${nm} NM out, beyond 5 NM`);
  }

  function rule1(w: WorldState, cross: Entry, land: Entry): Found {
    const c = cross.clearance, l = land.clearance, end = l.runway!, ct = trackOf(w, c.callsign);
    if (ct && ((ct.alt_ft ?? 0) > 100 || (m.entered.has(cross.callId) && !zonesOf(ct).some((r) => r.id === rid(end)))))
      return { why: `${spoken(c.callsign)} is clear of ${c.runway}` };
    const x = (c.taxiway && crossing(c.runway!, c.taxiway)) || (c.action === "cross_runway" ? (ct ? pos(ct) : null) : endOf(c.runway!)?.threshold ?? null);
    const xName = c.taxiway ?? (c.action === "cross_runway" ? "the crossing" : `the ${c.runway} threshold`);
    const a = arrival(w, land, x, xName);
    if (a.state !== "on" && a.state !== "final") return { why: a.why };
    const lt = a.t!, h = runwayOf(end)!.ends[0].heading;
    const xing: LonLat[] = !x ? [] : c.action === "cross_runway" ? [offset(x, h - 90, ZONE_HALF_WIDTH_M), offset(x, h + 90, ZONE_HALF_WIDTH_M)] : ct ? [pos(ct), x] : [];
    if (ct && xing.length === 2 && distM(pos(ct), xing[0]) > distM(pos(ct), xing[1])) xing.reverse();
    const secs = x && lt.speed_kt >= 1 ? Math.round((along(x, end) - a.s) / ((lt.speed_kt * NM) / 3600)) : null;
    return {
      why: a.why,
      d: {
        key: `crossing_on_landing_runway|${end}|${l.callsign}|${c.callsign}`,
        conflict: { t: w.clock.simT, rule: "crossing_on_landing_runway", runway: end, parties: [l.callsign, c.callsign], evidence: evidence(land, cross), severity_hint: "high" },
        level: "warning",
        text: `${spoken(c.callsign)} is ${R1[c.action][0]} runway ${c.runway} while ${spoken(l.callsign)} is landing on it.`,
        detail: `Rule 1 · ${R1[c.action][1]} clearance on a landing runway`,
        partyTrackIds: ct ? [lt.id, ct.id] : [lt.id],
        zoneRunway: end,
        paths: [xing, x ? [pos(lt), x] : []].filter((p) => p.length),
        point: x ?? undefined,
        countdown: secs === null ? undefined : { label: `${l.callsign} at ${xName} in ${secs} s`, seconds: secs },
        banner: true,
        triggerCallId: (tOf(w, cross.callId) >= tOf(w, land.callId) ? cross : land).callId, // whichever call made the conflict
      },
    };
  }

  /** Rule 1 candidates keyed `${arrival}|${crosser}`: every crossing-type clearance on a runway with a landing clearance. */
  function pairs(active: ActiveClearances) {
    const all = Object.values(active), out = new Map<string, [Entry, Entry]>();
    for (const land of all) {
      const l = land.clearance;
      if (l.action !== "cleared_to_land" || !endOf(l.runway ?? "")) continue;
      for (const cross of all) {
        const c = cross.clearance;
        if (c.action in R1 && c.callsign !== l.callsign && rid(c.runway) === rid(l.runway)) out.set(`${l.callsign}|${c.callsign}`, [cross, land]);
      }
    }
    // after "hold position" the alert stands until the arrival passes the crossing point or is clear
    for (const [k, [cross, land]] of m.latched) {
      const now = active[cross.clearance.callsign]?.clearance.action;
      if (!out.has(k) && active[land.clearance.callsign]?.callId === land.callId && (now === "stop" || now === "hold_short")) out.set(k, [cross, land]);
    }
    return out;
  }

  function rule2(w: WorldState, active: ActiveClearances, t: Track): Found {
    const cs = t.callsign, name = spoken(cs);
    const heard = !!active[cs] || m.heard.has(cs) || w.calls.some((c) => c.from === cs || c.to === cs || c.clearance?.callsign === cs);
    if (t.source !== "simulated" && !heard) return { why: "R2 not armed: no radio for this aircraft" };
    const zones = zonesOf(t);
    if (!zones.length) return { why: `${name} is outside every runway zone` };
    const ok = zones.find((r) => allows(active[cs], r.id) || m.inside.has(`${t.id}|${r.id}`));
    if (ok) return { why: `${name} is on ${runwayName(w, ok)} with a clearance` };
    const other = Object.values(active).find((e) => e.clearance.callsign !== cs && allows(e, zones[0].id));
    const rwy = other?.clearance.runway ?? runwayName(w, zones[0]), ot = other && trackOf(w, other.clearance.callsign);
    return {
      why: `${name} is on ${rwy} with no clearance`,
      d: {
        key: `runway_incursion_no_clearance|${rwy}|${cs}`,
        conflict: { t: w.clock.simT, rule: "runway_incursion_no_clearance", runway: rwy, parties: other ? [cs, other.clearance.callsign] : [cs], evidence: other ? evidence(other) : [], severity_hint: "high" },
        level: "warning",
        text: `${name} is on runway ${rwy} with no clearance${other ? ` while ${spoken(other.clearance.callsign)} is ${ON_IT[other.clearance.action]} it` : ""}.`,
        detail: "Rule 2 · on a runway with no clearance",
        partyTrackIds: ot ? [t.id, ot.id] : [t.id],
        zoneRunway: rwy,
        paths: [],
        point: pos(t),
        banner: true,
      },
    };
  }

  /** Newest confident readback by the same callsign after its standing instruction. */
  function readbackOf(w: WorldState, e: Entry) {
    const t0 = tOf(w, e.callId);
    return w.calls.find((c) => !c.lowConfidence && c.clearance?.action === "readback" && c.clearance.callsign === e.clearance.callsign && c.t > t0);
  }

  function rule4(w: WorldState, e: Entry): Detection | null {
    const rb = readbackOf(w, e), d = rb && mismatch(rb.clearance!, e.clearance);
    if (!rb || !d || unsure(w, e.clearance.callsign, tOf(w, e.callId), rb.t)) return null;
    const ins = e.clearance, cs = ins.callsign, t = trackOf(w, cs);
    return {
      key: `readback_mismatch|${ins.runway ?? ""}|${cs}|${rb.id}`,
      conflict: { t: w.clock.simT, rule: "readback_mismatch", runway: ins.runway ?? "", parties: [cs], evidence: evidence(e, { clearance: rb.clearance!, callId: rb.id }), severity_hint: "medium" },
      level: "caution",
      text: `${spoken(cs)} read back ${d[0]}, but the instruction was ${d[1]}.`,
      detail: "Rule 4 · readback does not match the instruction",
      partyTrackIds: t ? [t.id] : [],
      zoneRunway: ins.runway,
      paths: [],
      point: (ins.runway && ins.taxiway && crossing(ins.runway, ins.taxiway)) || undefined,
      banner: true,
      triggerCallId: rb.id,
    };
  }

  const airfield: Airfield = {
    applyClearance(active, clearance, callId) {
      if (clearance.action !== "readback") active[clearance.callsign] = { clearance, callId };
    },

    checkCall(call, w, active) {
      const c = call.clearance;
      if (!c || call.lowConfidence) {
        const why = c ? `not checked: confidence ${c.confidence.toFixed(2)} is below ${w.ui.threshold}` : "no clearance in this call";
        return RULES.map((rule) => ({ rule, pass: true, why }));
      }
      const act: ActiveClearances = c.action === "readback" ? active : { ...active, [c.callsign]: { clearance: c, callId: call.id } };
      const t = trackOf(w, c.callsign), ins = active[c.callsign];
      const r1 = [...pairs(act).values()].filter(([x, l]) => x.callId === call.id || l.callId === call.id).map((p) => rule1(w, ...p));
      const hit = r1.find((r) => r.d);
      const r2: Found = t ? rule2(w, act, t) : { why: `no track for ${spoken(c.callsign)}` };
      const vague = c.action === "readback" && !!ins && unsure(w, c.callsign, tOf(w, ins.callId), call.t);
      const lo = below(w.weather), d4 = c.action === "readback" && ins && !vague ? mismatch(c, ins.clearance) : null;
      return [
        {
          rule: "crossing_on_landing_runway", pass: !hit,
          why: (hit ?? r1[0])?.why ?? (c.action in R1 ? `${c.runway} has no landing clearance` : c.action === "cleared_to_land" ? `no crossing or takeoff clearance on ${c.runway}` : "no runway entry in this clearance"),
        },
        { rule: "runway_incursion_no_clearance", pass: !r2.d, why: r2.why },
        {
          rule: "weather_below_minimums", pass: !lo || c.action !== "cleared_to_land",
          why: !lo ? `${wx(w.weather)}: above minimums` : c.action === "cleared_to_land" ? `landing clearance with ${wx(w.weather)}: below minimums` : `${wx(w.weather)}: below minimums, weather panel only`,
        },
        {
          rule: "readback_mismatch", pass: !d4,
          why: c.action !== "readback" ? "not a readback" : !ins ? "no instruction to compare" : vague ? "the latest instruction was low confidence: nothing to compare" : d4 ? `read back ${d4[0]}, instruction was ${d4[1]}` : `matches ${shorthand(ins.clearance)}`,
        },
      ];
    },

    evaluate(w, active) {
      const now = Date.parse(w.clock.simT);
      if (now < m.lastMs) m = fresh();
      m.lastMs = now;
      for (const c of w.calls) for (const cs of [c.from, c.to, c.clearance?.callsign]) if (cs) m.heard.add(cs);
      for (const t of w.tracks) {
        const zones = zonesOf(t), e = active[t.callsign];
        for (const r of RUNWAYS) {
          const k = `${t.id}|${r.id}`;
          if (!zones.includes(r)) { m.inside.delete(k); continue; }
          m.lastInZone.set(k, now);
          if (allows(e, r.id)) { m.inside.add(k); if (e!.clearance.action in R1) m.entered.add(e!.callId); }
        }
      }
      const out: Detection[] = [], p = pairs(active);
      m.latched = new Map();
      for (const [k, pair] of p) { const r = rule1(w, ...pair); if (r.d) { out.push(r.d); m.latched.set(k, pair); } }
      for (const t of w.tracks) { const r = rule2(w, active, t); if (r.d) out.push(r.d); }
      if (below(w.weather)) {
        const rwy = w.config.arr[0] ?? "";
        out.push({
          key: `weather_below_minimums|${rwy}`,
          conflict: { t: w.clock.simT, rule: "weather_below_minimums", runway: rwy, parties: [], evidence: [], severity_hint: "medium" },
          level: "caution",
          text: `Weather is below landing minimums: ${wx(w.weather)}.`,
          detail: "Rule 3 · below landing minimums (demo values: ceiling 200 ft, visibility 1/2 SM)",
          partyTrackIds: [], paths: [], banner: false,
        });
        for (const e of Object.values(active)) {
          const end = e.clearance.runway ?? "", cs = e.clearance.callsign;
          if (e.clearance.action !== "cleared_to_land" || !endOf(end)) continue;
          const a = arrival(w, e, null, "");
          if (a.state !== "on" && a.state !== "final" && a.state !== "far") continue;
          out.push({
            key: `weather_below_minimums|${end}|${cs}`,
            conflict: { t: w.clock.simT, rule: "weather_below_minimums", runway: end, parties: [cs], evidence: evidence(e), severity_hint: "high" },
            level: "warning",
            text: `${spoken(cs)} is cleared to land on ${end} with weather below landing minimums.`,
            detail: "Rule 3 · landing clearance below minimums",
            partyTrackIds: [a.t!.id], zoneRunway: end, paths: [[pos(a.t!), endOf(end)!.threshold]], point: endOf(end)!.threshold,
            banner: true, triggerCallId: e.callId,
          });
        }
      }
      for (const e of Object.values(active)) { const d = rule4(w, e); if (d) out.push(d); }
      return out;
    },

    deriveStrips(w, active) {
      const strips: Strip[] = [];
      for (const t of w.tracks) {
        const cs = t.callsign, e = active[cs], p = pos(t);
        const bay = bayOf(w, t, e?.clearance);
        if (bay === "departed") continue;
        const last = w.calls.find((c) => c.clearance?.callsign === cs || c.from === cs || c.to === cs);
        // a low-confidence call never enters `active`, but the strip shows what was heard, flagged by its confidence
        const shown = last?.lowConfidence && last.clearance && last.clearance.action !== "readback" ? last.clearance : e?.clearance;
        const alerts = w.alerts.filter((a) => a.status === "active" && a.banner && (a.partyTrackIds.includes(t.id) || a.conflict.parties.includes(cs)));
        const arr = bay === "arriving" ? approachEnd(w, t, e?.clearance) : undefined;
        const apron = bay === "at_gate" ? APRONS.find((ap) => inRing(p, ap.ring)) : undefined;
        strips.push({
          trackId: t.id, callsign: cs, kind: t.kind, type: t.type, bay,
          clearance: shown && shorthand(shown), clearanceT: shown?.t,
          distanceNm: arr ? Math.round(toThresholdNm(p, arr) * 10) / 10 : undefined,
          speedKt: Math.round(t.speed_kt),
          source: t.source, estimated: !!t.estimated, radioOnly: !!t.estimated,
          confidence: last?.lowConfidence ? last.clearance?.confidence : undefined,
          state: alerts.some((a) => a.level === "warning") ? "warning" : alerts.length || last?.lowConfidence ? "caution" : "normal",
          lastCallT: last?.t,
          // shortcut: gate number is a stable hash of the track id (labelled SIM); real stand data would replace it
          gate: apron && `${apron.name.match(/Area (\w)$/)?.[1] ?? ""}${([...t.id].reduce((h, ch) => h + ch.charCodeAt(0), 0) % 12) + 1}`,
        });
      }
      return strips.sort((a, b) => BAY_ORDER.indexOf(a.bay) - BAY_ORDER.indexOf(b.bay) || (b.lastCallT ?? "").localeCompare(a.lastCallT ?? ""));
    },

    weatherStatus(weather, config) {
      const runway = config.arr[0] ?? "";
      return { runway, belowMinimums: below(weather), ...windComponents(weather.wind_dir, weather.wind_kt, runway), minimums: { ...MINIMUMS } };
    },
  };
  return airfield;
};
