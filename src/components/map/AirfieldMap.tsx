"use client";
// Airfield map drawn as SVG from the bundled OSM airfield in the tower-window view (sfo.project). No map library.
// Everything is drawn in screen pixels, so labels and strokes keep one size at every zoom.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Alert, Track, WorldState } from "@/lib/contract";
import {
  ATTRIBUTION, FEATURES, NM, RUNWAYS, VIEW_BEARING, approachLine, crossing, distM, endOf, offset, project, runwayOf, zonePolygon,
} from "@/lib/sfo";
import gatesGeo from "../../../data/sfo-gates.json";

type LonLat = [number, number];
type XY = [number, number];
type Frame = { s: number; tx: number; ty: number };
type Pos = { p: XY; h: number };
type Motion = { from: Pos; to: Pos; t0: number };

const DUR = 250; // ms, one 4 Hz world update
const CHEVRON = "M0,-12L9,9L0,4L-9,9Z"; // points up = heading VIEW_BEARING

// ---- Static geometry in projected metres, built once ----
const rings = (aeroway: string, type: "Polygon" | "LineString"): XY[][] =>
  FEATURES.filter((f) => f.properties.aeroway === aeroway && f.geometry.type === type).flatMap((f) =>
    type === "Polygon" ? (f.geometry.coordinates as LonLat[][]).map((r) => r.map(project)) : [(f.geometry.coordinates as LonLat[]).map(project)],
  );
const APRONS = rings("apron", "Polygon"), TERMINALS = rings("terminal", "Polygon");
const TAXIWAYS = rings("taxiway", "LineString"), HOLDS = rings("holding_position", "LineString");
const RWYS = RUNWAYS.map((r) => r.ends.map((e) => project(e.threshold)) as [XY, XY]);
// Stopways (overruns) as [threshold end, far end], so a runway reads at its full paved length
const STOPS = rings("stopway", "LineString").map((l): [XY, XY] => {
  const a = l[0], b = l[l.length - 1], d = (p: XY) => Math.min(...RWYS.flat().map((t) => Math.hypot(p[0] - t[0], p[1] - t[1])));
  return d(a) < d(b) ? [a, b] : [b, a];
});
// Jet bridges and parking-position lead-in lines from OSM (data/sfo-gates.json): faint texture only, no labels
const GATES = (gatesGeo as { features: { geometry: { type: string; coordinates: unknown } }[] }).features
  .filter((g) => g.geometry.type === "LineString").map((g) => (g.geometry.coordinates as LonLat[]).map(project));
const FIELD: XY[] = [...RWYS.flat(), ...STOPS.flat(), ...APRONS.flat(), ...TERMINALS.flat()];
// each runway end as [threshold, end of its stopway], kept clear of labels
const ENDS = RWYS.flat().map((t): [XY, XY] => [t, STOPS.find(([a]) => Math.hypot(a[0] - t[0], a[1] - t[1]) < 50)?.[1] ?? t]);
const TERM_C = ((ps: XY[]): XY => [ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length])(TERMINALS.flat());

// Label tiers: runway clearances are tier 1; their shorthand comes from the strip ("CLRD LAND 28L", "LUAW 1L", "XING 28L @P").
const RWY_CLR = /^(CLRD|LUAW|XING)/;
const DOCK = 200; // px of the map top under the console's alert dock while an alert is up (taller at 1440 wide)
type Box = [number, number, number, number]; // x, y, w, h
// right, left, above, below; al = text alignment (0 start, 0.5 middle, 1 end)
const SIDES = [{ x: 1, y: 0, al: 0 }, { x: -1, y: 0, al: 1 }, { x: 0, y: -1, al: 0.5 }, { x: 0, y: 1, al: 0.5 }] as const;
const ANCHOR = { 0: "start", 0.5: "middle", 1: "end" } as const;

function segX([a, b]: [XY, XY], [c, d]: [XY, XY]): XY | null {
  const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
  if (Math.abs(den) < 1e-6) return null;
  const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
  const u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])] : null;
}
// "corridor" with no alert: the box around where the 1s cross the 28s, plus 600 m
const INTERSECTION_BOX: XY[] = RWYS.flatMap((a, i) => RWYS.slice(i + 1).map((b) => segX(a, b)))
  .filter((p): p is XY => !!p)
  .flatMap(([x, y]) => [[x - 600, y - 600], [x + 600, y + 600]] as XY[]);

// only 0.6 NM of each final, so the airfield fills the map; arrivals further out show as edge markers
const finalsBox = (arr: string[]): XY[] => arr.filter((e) => endOf(e)).map((e) => project(approachLine(e, 0.6)[0]));
function corridorBox(a: Alert): XY[] {
  const pts: LonLat[] = [...(a.zoneRunway && runwayOf(a.zoneRunway) ? zonePolygon(a.zoneRunway) : []), ...a.paths.flat(), ...(a.point ? [a.point] : [])];
  return pts.length ? pts.map(project) : INTERSECTION_BOX;
}
/** Uniform fit: `pts` stay below the alert dock strip (`top` px); `extra` (the finals) may run up under it. */
function fit(pts: XY[], extra: XY[], w: number, h: number, top: number, pad: number): Frame {
  const all = [...pts, ...extra], xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), py0 = Math.min(...pts.map((p) => p[1]));
  const s = Math.min((w - 2 * pad) / Math.max(x1 - x0, 1), (h - 2 * pad) / Math.max(y1 - y0, 1), (h - top - 2 * pad) / Math.max(y1 - py0, 1));
  const lo = Math.max(top + pad - s * py0, pad - s * y0), hi = h - pad - s * y1;
  return { s, tx: w / 2 - (s * (x0 + x1)) / 2, ty: (lo + hi) / 2 };
}

// Taxiway sign anchor: ~300 m up the taxiway from the runway it crosses, so it sits off the pavement the alert paints.
const anchors = new Map<string, XY | null>();
function taxiwayAnchor(ref: string, runway?: string): XY | null {
  const k = `${ref}|${runway ?? ""}`;
  if (!anchors.has(k)) {
    const verts = FEATURES.filter((f) => f.properties.aeroway === "taxiway" && f.properties.ref === ref && f.geometry.type === "LineString")
      .flatMap((f) => f.geometry.coordinates as LonLat[]);
    const x = runway ? crossing(runway, ref) : null;
    const v = x ? verts.reduce((a, b) => (Math.abs(distM(b, x) - 300) < Math.abs(distM(a, x) - 300) ? b : a)) : verts[verts.length >> 1];
    anchors.set(k, v ? project(v) : null);
  }
  return anchors.get(k)!;
}

const px = (f: Frame, p: XY): XY => [p[0] * f.s + f.tx, p[1] * f.s + f.ty];
const pathD = (f: Frame, ls: XY[][], close = false) =>
  ls.map((l) => "M" + l.map((p) => px(f, p).map((n) => n.toFixed(1)).join(",")).join("L") + (close ? "Z" : "")).join("");

function at(m: Motion, now: number): Pos {
  const a = Math.min(1, (now - m.t0) / DUR);
  const dh = ((m.to.h - m.from.h + 540) % 360) - 180;
  return { p: [m.from.p[0] + (m.to.p[0] - m.from.p[0]) * a, m.from.p[1] + (m.to.p[1] - m.from.p[1]) * a], h: m.from.h + dh * a };
}

const signW = (text: string, size: number) => Math.round(text.length * size * 0.6 + size);
/** Location-sign panel (black field, yellow border + legend), the red countdown panel, or a mandatory runway holding-position sign (.sign-mand). Width estimated from the legend. */
function Sign({ x, y, text, size = 15, warn, mand, dim }: { x: number; y: number; text: string; size?: number; warn?: boolean; mand?: boolean; dim?: boolean }) {
  const w = signW(text, size), h = Math.round(size * 1.55);
  return (
    <g transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`} opacity={dim ? 0.3 : 1}>
      {mand && <rect x={-w / 2 - 3} y={-h / 2 - 3} width={w + 6} height={h + 6} rx={3} className="fill-sign-black" />}
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={2} className={warn ? "fill-warn" : mand ? "fill-warn-sign stroke-white" : "fill-sign-black stroke-sign-yellow"} strokeWidth={warn ? 0 : 2} />
      <text textAnchor="middle" dominantBaseline="central" fontSize={size} fontWeight={800} className={warn ? "fill-sign-black" : mand ? "fill-white" : "fill-sign-yellow"}>{text}</text>
    </g>
  );
}

export function AirfieldMap({ world, selectedTrackId, onSelect, zoom = "field", variant = "console" }: {
  world: WorldState | null;
  selectedTrackId?: string | null;
  onSelect?: (id: string | null) => void;
  zoom?: "field" | "corridor";
  variant?: "console" | "hero";
}) {
  const hero = variant === "hero", k = hero ? 1.6 : 1;
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const box = useRef<HTMLDivElement>(null);
  const [[W, H], setSize] = useState<XY>([1200, 700]);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => { if (e.contentRect.width > 10) setSize([e.contentRect.width, e.contentRect.height]); });
    ro.observe(box.current!);
    return () => ro.disconnect();
  }, []);

  const tracks = world?.tracks;
  const arr = world?.config.arr ?? ["28L", "28R"];
  const arrKey = arr.join(",");
  const dep = world?.config.dep ?? [];
  const warn = world?.alerts.find((a) => a.status === "active" && a.level === "warning" && a.banner);
  const top = !hero && world?.alerts.some((x) => x.status === "active" && x.banner) ? DOCK : 0;

  // Framing holds still for the life of an alert; it changes only with zoom, the alert (and its dock), the config or the window.
  const pts = useMemo(
    (): [XY[], XY[]] => (zoom === "corridor" ? [warn ? corridorBox(warn) : INTERSECTION_BOX, []] : [FIELD, finalsBox(arrKey.split(","))]),
    [zoom, warn?.id, arrKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const f = useMemo(() => fit(pts[0], pts[1], W, H, top, zoom === "corridor" ? 56 : 30), [pts, W, H, top, zoom]);
  const frame = useRef(f);
  frame.current = f;
  const P = (p: XY) => px(f, p);
  const D = (ls: XY[][], close = false) => pathD(f, ls, close);

  const staticLayer = useMemo(() => {
    const P = (p: XY) => px(f, p);
    const D = (ls: XY[][], close = false) => pathD(f, ls, close);
    const rwyW = Math.max(61 * f.s, 7) * k;
    const finals = arrKey.split(",").filter((e) => endOf(e)).map((e) => {
      const end = endOf(e)!, back = (end.heading + 180) % 360;
      const [x0, y0] = P(project(end.threshold)), [x5, y5] = P(project(approachLine(e, 5)[0]));
      const len = Math.hypot(x5 - x0, y5 - y0) || 1, nx = (-(y5 - y0) / len) * 9 * k, ny = ((x5 - x0) / len) * 9 * k;
      const ticks = [1, 2, 3, 4, 5].map((n) => P(project(offset(end.threshold, back, n * NM)))).map(([x, y]) => `M${(x - nx).toFixed(1)},${(y - ny).toFixed(1)}L${(x + nx).toFixed(1)},${(y + ny).toFixed(1)}`);
      return `M${x0.toFixed(1)},${y0.toFixed(1)}L${x5.toFixed(1)},${y5.toFixed(1)}${ticks.join("")}`;
    }).join("");
    const hw = rwyW / 2, seg = (a: XY, b: XY) => `M${a[0].toFixed(1)},${a[1].toFixed(1)}L${b[0].toFixed(1)},${b[1].toFixed(1)}`;
    const across = (t: XY, o: XY) => { const l = Math.hypot(o[0] - t[0], o[1] - t[1]) || 1; return { u: [(o[0] - t[0]) / l, (o[1] - t[1]) / l] as XY, l }; };
    // overrun chevrons point at the threshold, one per 30 m of stopway
    const chevrons = STOPS.map(([a, b]) => {
      const t = P(a), { u: [ux, uy], l } = across(t, P(b)), gap = Math.max(30 * f.s, 6), out: string[] = [];
      for (let d = hw * 0.8 + 3; d <= l - 1; d += gap) {
        const c: XY = [t[0] + ux * d, t[1] + uy * d];
        out.push(`M${(c[0] - uy * hw * 0.8).toFixed(1)},${(c[1] + ux * hw * 0.8).toFixed(1)}L${(c[0] - ux * hw * 0.8).toFixed(1)},${(c[1] - uy * hw * 0.8).toFixed(1)}L${(c[0] + uy * hw * 0.8).toFixed(1)},${(c[1] - ux * hw * 0.8).toFixed(1)}`);
      }
      return out.join("");
    }).join("");
    const bars = RWYS.flatMap(([a, b]) => [[a, b], [b, a]]).map(([a, b]) => {
      const t = P(a), { u: [ux, uy] } = across(t, P(b));
      return seg([t[0] - uy * hw, t[1] + ux * hw], [t[0] + uy * hw, t[1] - ux * hw]);
    }).join("");
    return (
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {/* aprons close to taxiway tone so apron taxilanes melt into one soft mass; terminals a solid block on it */}
        <path d={D(APRONS, true)} className="fill-raised" fillRule="evenodd" />
        <path d={D(TERMINALS, true)} className="fill-seam" fillRule="evenodd" />
        <path d={D(TAXIWAYS)} className="stroke-taxiway" strokeWidth={Math.max(23 * f.s, 3) * k} />
        <path d={D(GATES)} className="stroke-ink-3" strokeWidth={1} opacity={0.3} />
        <path d={D([...RWYS, ...STOPS])} className="stroke-runway" strokeWidth={rwyW} strokeLinecap="butt" />
        <path d={chevrons} className="stroke-ink-3" strokeWidth={1.25 * k} opacity={0.7} />
        <path d={D(RWYS)} className="stroke-paint" strokeWidth={1.5 * k} strokeDasharray="12 10" opacity={0.8} />
        <path d={bars} className="stroke-paint" strokeWidth={2.5 * k} strokeLinecap="butt" />
        <path d={D(HOLDS)} className="stroke-ink-3" strokeWidth={1.25 * k} opacity={0.7} />
        <path d={finals} className="stroke-ink-3" strokeWidth={1.5 * k} />
      </g>
    );
  }, [f, k, arrKey]);

  // ---- Smooth target motion: React renders targets at 4 Hz, rAF moves them (transform is never a React prop) ----
  const els = useRef(new Map<string, SVGGElement>());
  const motion = useRef(new Map<string, Motion>());
  const place = useRef((now: number) => {
    const { s, tx, ty } = frame.current;
    for (const [id, m] of motion.current) {
      const el = els.current.get(id);
      if (!el) continue;
      const { p, h } = at(m, now);
      el.setAttribute("transform", `translate(${(p[0] * s + tx).toFixed(1)},${(p[1] * s + ty).toFixed(1)})`);
      el.querySelector("[data-rot]")?.setAttribute("transform", `rotate(${(h - VIEW_BEARING).toFixed(1)})`);
    }
  }).current;
  useLayoutEffect(() => {
    const now = performance.now(), next = new Map<string, Motion>();
    for (const t of tracks ?? []) {
      const to = { p: project([t.lon, t.lat]), h: t.heading }, cur = motion.current.get(t.id);
      next.set(t.id, { from: cur ? at(cur, now) : to, to, t0: now });
    }
    motion.current = next;
  }, [tracks]);
  useLayoutEffect(() => place(performance.now())); // new elements and new framing land before paint
  useEffect(() => {
    let raf = 0;
    const loop = () => { place(performance.now()); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [place]);

  // A normal call pulses its linked target once (the link can land after the caption appears).
  const capId = world?.caption?.callId;
  const linked = capId ? world?.calls.find((c) => c.id === capId)?.linkedTrackId : undefined;
  useEffect(() => {
    const ring = linked && els.current.get(linked)?.querySelector("[data-pulse]");
    if (!ring) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    ring.animate(still ? [{ opacity: 1 }, { opacity: 0 }] : [{ transform: "scale(0.6)", opacity: 1 }, { transform: "scale(2.6)", opacity: 0 }], { duration: 900, easing: "ease-out" });
  }, [capId, linked]);

  // Taxiway signs: taxiways in each callsign's latest controller instruction, plus the alert's call.
  const twys = new Map<string, string | undefined>();
  const alertCall = warn?.callId ? world?.calls.find((c) => c.id === warn.callId) : undefined;
  if (alertCall?.clearance?.taxiway) twys.set(alertCall.clearance.taxiway, alertCall.clearance.runway);
  if (!hero && world) {
    const seen = new Set<string>();
    for (const c of world.calls) {
      const cl = c.clearance;
      if (!cl || c.lowConfidence || (cl.speaker !== "tower" && cl.speaker !== "ground") || seen.has(cl.callsign)) continue;
      seen.add(cl.callsign);
      if (cl.taxiway && !twys.has(cl.taxiway)) twys.set(cl.taxiway, cl.runway);
    }
  }

  const parties = new Set(warn?.partyTrackIds ?? []);
  const zoneEnds = warn?.zoneRunway ? runwayOf(warn.zoneRunway)?.ends.map((e) => e.name) ?? [] : [];
  const pt = warn?.point ? P(project(warn.point)) : null;

  // Runway holding-position sign at the hold-short where the crossing path starts: both ends, the one on the holder's left first.
  const xing = warn?.zoneRunway && alertCall?.clearance?.taxiway && (warn.paths[0]?.length ?? 0) > 1 ? warn.paths[0] : null;
  const hold = (() => {
    const rw = xing && runwayOf(warn!.zoneRunway!);
    if (!xing || !rw) return null;
    const [hx, hy] = P(project(xing[0])), [cx, cy] = P(project(xing[1]));
    const fl = Math.hypot(cx - hx, cy - hy) || 1, fx = (cx - hx) / fl, fy = (cy - hy) / fl; // facing across the runway
    const [t0x, t0y] = P(project(rw.ends[0].threshold));
    const ends = (t0x - hx) * fy - (t0y - hy) * fx > 0 ? rw.ends : [rw.ends[1], rw.ends[0]];
    const text = `${ends[0].name}-${ends[1].name}`, w = signW(text, 14), h = Math.round(14 * 1.55);
    const s = fy > 0 ? -1 : 1; // beside the taxiway on the screen-left side, away from the holder's callsign label
    const sx = fy * s, sy = -fx * s, reach = (w / 2) * Math.abs(sx) + (h / 2) * Math.abs(sy) + 14;
    const back = (h / 2) * Math.abs(fy) + (w / 2) * Math.abs(fx) * 0.25 + 4; // behind the hold line, off the zone edge
    return { x: hx + sx * reach - fx * back, y: hy + sy * reach - fy * back, text };
  })();

  // FAA-diagram designators: upright, just past the threshold, beside the extended centerline so they clear the final approach line
  const designators = hero ? [] : RUNWAYS.flatMap((r, i) => r.ends.map((e, j) => {
    const [ax, ay] = P(RWYS[i][j]), [bx, by] = P(RWYS[i][1 - j]), len = Math.hypot(ax - bx, ay - by) || 1;
    const ux = (ax - bx) / len, uy = (ay - by) / len; // out past the threshold
    const side = e.name.endsWith("L") ? 1 : e.name.endsWith("R") ? -1 : 0; // parallel pairs: L to the pilot's left, R to the right, so a pair never touches
    const hw = e.name.length * 4.6 + 3, hh = 8.5;
    const along = hw * Math.abs(ux) + hh * Math.abs(uy) + 6, out = (hw * Math.abs(uy) + hh * Math.abs(ux) + 3) * side;
    const x = ax + ux * along - uy * out, y = ay + uy * along + ux * out;
    return { name: e.name, x, y, box: [x - hw - 4, y - hh - 4, 2 * hw + 8, 2 * hh + 8] as Box }; // 4 px margin keeps labels off the designator
  }));

  // Labels by tier, placed greedily so none overlaps another label, a designator or a sign:
  // 1 runway clearance / on a runway / on final / alert party / selected / caption target: callsign + clearance, may try all four sides;
  // 2 other clearance or moving: callsign only, right or left side (right only in a warning) or nothing; 3 parked with no clearance: small faint symbol, no label.
  const stripOf = new Map(world?.strips.map((s) => [s.trackId, s]));
  const tierOf = (t: Track) => {
    const s = stripOf.get(t.id), clr = s?.clearance ?? "";
    if (parties.has(t.id) || t.id === selectedTrackId || t.id === linked || s?.bay === "on_runway" || s?.bay === "arriving"
      || (RWY_CLR.test(clr) && s?.bay !== "taxi_in" && s?.bay !== "at_gate")) return 1;
    return (clr && s?.bay !== "at_gate") || s?.bay === "holding_short" || t.speed_kt > 5 ? 2 : 3;
  };
  const tiers = new Map(tracks?.map((t) => [t.id, tierOf(t)]));
  // Obstacles: designators, signs and every labelled target's symbol. The countdown, then the labels, are placed around them.
  const taken: Box[] = designators.map((d) => d.box);
  if (hold) { const w = signW(hold.text, 14) + 6; taken.push([hold.x - w / 2, hold.y - 14, w, 28]); }
  for (const [ref, rwy] of twys) {
    const a = taxiwayAnchor(ref, rwy), w = signW(ref, 14);
    if (a) { const [x, y] = P(a); taken.push([x - w / 2, y - 11, w, 22]); }
  }
  const signs = taken.slice(); // designators and signs: the countdown leader must not cross them
  for (const t of tracks ?? []) if (tiers.get(t.id)! < 3) { const [x, y] = P(project([t.lon, t.lat])); taken.push([x - 12, y - 12, 24, 24]); }
  // Runway ends (threshold + stopway) are soft obstacles: worth < 1 px² of real overlap, so tier 1 still labels beside them
  const rwyW = Math.max(61 * f.s, 7) * k;
  const ends = ENDS.map(([a, b]): Box => { const [p, q] = [P(a), P(b)], m = rwyW / 2 + 4; return [Math.min(p[0], q[0]) - m, Math.min(p[1], q[1]) - m, Math.abs(p[0] - q[0]) + 2 * m, Math.abs(p[1] - q[1]) + 2 * m]; });
  const area = (b: Box, os: Box[]) => os.reduce((c, o) => c + Math.max(0, Math.min(b[0] + b[2], o[0] + o[2]) - Math.max(b[0], o[0])) * Math.max(0, Math.min(b[1] + b[3], o[1] + o[3]) - Math.max(b[1], o[1])), 0);
  const cost = (b: Box) => (b[0] < 0 || b[0] + b[2] > W || b[1] < top || b[1] + b[3] > H ? Infinity : area(b, taken) + area(b, ends) / 1e4);

  // Countdown: off the pavement, on the side of the zone runway away from the terminals, with a leader back to the conflict point.
  const cd = (() => {
    if (!pt || !warn?.countdown) return null;
    const text = warn.countdown.label, w = signW(text, 20), h = 31;
    const ri = warn.zoneRunway ? RUNWAYS.indexOf(runwayOf(warn.zoneRunway)!) : -1;
    let nx = 0, ny = 1; // no zone runway: below the point (arrivals come in from the top of the tower view)
    if (ri >= 0) {
      const [a, b] = RWYS[ri].map(P), l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, [tx, ty] = P(TERM_C);
      nx = -(b[1] - a[1]) / l; ny = (b[0] - a[0]) / l;
      if (nx * (tx - pt[0]) + ny * (ty - pt[1]) > 0) { nx = -nx; ny = -ny; }
    }
    const d0 = 130 * f.s + 24 + (w / 2) * Math.abs(nx) + (h / 2) * Math.abs(ny); // past the 85 m zone edge, plus half the panel
    // step straight out along the normal first, then slide along the runway; the first clearest spot wins
    const boxes = [0, 0.5, -0.5].flatMap((sl) => [0, 50, 100, 150].map((dd): Box => {
      const x = Math.min(Math.max(pt[0] + nx * (d0 + dd) + ny * sl * w, w / 2 + 8), W - w / 2 - 8), y = Math.min(Math.max(pt[1] + ny * (d0 + dd) - nx * sl * w, top + h / 2 + 8), H - h / 2 - 8);
      return [x - w / 2, y - h / 2, w, h];
    }));
    // a leader that crosses a sign or designator costs more than any overlap
    const crosses = (b: Box) => Array.from({ length: 25 }, (_, i) => i / 24).some((u) => {
      const x = pt[0] + (b[0] + w / 2 - pt[0]) * u, y = pt[1] + (b[1] + h / 2 - pt[1]) * u;
      return signs.some((o) => x > o[0] && x < o[0] + o[2] && y > o[1] && y < o[1] + o[3]);
    });
    const box = boxes.map((b) => ({ b, c: cost(b) + (crosses(b) ? 1e7 : 0) })).reduce((m, n) => (n.c < m.c ? n : m)).b;
    taken.push(box);
    return { x: box[0] + w / 2, y: box[1] + h / 2, text };
  })();

  const labels = new Map<string, { al: 0 | 0.5 | 1; dx: number; dy: number; rx: number; cw: number; tags: string[]; lines: [string, string][] }>();
  const g = 16 * k;
  const lastSide = useRef(new Map<string, (typeof SIDES)[number]>());
  // alert parties first, slowest first (the holder at the line is boxed in; the arrival's label moves on with it)
  const rank = (t: Track) => (parties.has(t.id) ? t.speed_kt / 1000 : t.id === selectedTrackId ? 1 : tiers.get(t.id) === 1 ? 2 : 3);
  for (const t of (tracks ?? []).filter((t) => (hero ? parties.has(t.id) : tiers.get(t.id)! < 3)).sort((a, b) => rank(a) - rank(b))) {
    const one = tiers.get(t.id) === 1, must = parties.has(t.id) || t.id === selectedTrackId;
    const strip = stripOf.get(t.id), tags = one ? [t.source === "simulated" && "SIM", t.estimated && "EST"].filter((x): x is string => !!x) : [];
    const lines: [string, string][] = !one || hero ? [] : t.id === selectedTrackId
      ? [[[t.type ?? strip?.type, `${Math.round(t.speed_kt)} kt`].filter(Boolean).join(" · "), "fill-ink-2"], ...(strip?.clearance ? [[strip.clearance, "fill-clear"] as [string, string]] : [])]
      : strip?.clearance ? [[strip.clearance, "fill-clear"]] : [];
    const cw = t.callsign.length * (one ? 10.5 : 9.3), rw = cw + (tags.length ? tags.length * 36 + 2 : 0); // SIM/EST sit on the callsign row, as on the strips
    const w = Math.max(rw, ...lines.map(([l]) => l.length * 9)), bottom = 10 + lines.length * 20;
    const [x, y] = P(project([t.lon, t.lat]));
    if (x < 0 || x > W || y < top || y > H) continue; // off the map (or under the dock): its edge marker carries the callsign
    const dy = (s: (typeof SIDES)[number]) => (s.y < 0 ? -g - bottom : s.y > 0 ? g + 10 : 0);
    const boxOf = (s: (typeof SIDES)[number]): Box => [x + s.x * g - w * s.al, y + dy(s) - 10, w, bottom + 10];
    // tier 1 takes the clearest of four sides (alert parties and the selection even if none is clear); tier 2 right or left (right only during a warning), or nothing
    const cands = one ? SIDES : SIDES.slice(0, warn ? 1 : 2), prev = lastSide.current.get(t.id);
    const order = prev && cands.includes(prev) ? [prev, ...cands.filter((s) => s !== prev)] : cands;
    const best = order.map((s) => ({ s, c: cost(boxOf(s)) })).reduce((m, n) => (n.c < m.c ? n : m)); // a label keeps its side while that side stays clear
    if (best.c >= (one ? 1 : 1e-9) && !must) continue;
    taken.push(boxOf(best.s));
    lastSide.current.set(t.id, best.s);
    labels.set(t.id, { al: best.s.al, dx: best.s.x * g, dy: dy(best.s), rx: -rw * best.s.al, cw, tags, lines });
  }

  // Arrivals beyond the frame: chevron + "BYL646 4.8 NM" where their final approach line leaves the map.
  const M = 22;
  const edgeMarker = (t: Track) => {
    const q = P(project([t.lon, t.lat]));
    if (hero || t.kind !== "aircraft" || !t.alt_ft || (q[0] >= 0 && q[0] <= W && q[1] >= top && q[1] <= H)) return null; // under the dock counts as off the map
    const near = arr.filter((e) => endOf(e)).map((e) => {
      const a = P(project(endOf(e)!.threshold)), b = P(project(approachLine(e, 5)[0]));
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      return { e, a, dx: dx / l, dy: dy / l, off: Math.abs((q[0] - a[0]) * dy - (q[1] - a[1]) * dx) / l / f.s, ahead: (q[0] - a[0]) * dx + (q[1] - a[1]) * dy };
    }).filter((c) => c.ahead > 0 && c.off < NM).sort((m, n) => m.off - n.off)[0];
    const a = near?.a;
    if (!near || !a || a[0] < M || a[0] > W - M || a[1] < top + M || a[1] > H - M) return null; // threshold off the map (corridor zoom): no exit to mark
    const { dx, dy } = near;
    const tx = dx > 0 ? (W - M - a[0]) / dx : dx < 0 ? (M - a[0]) / dx : Infinity, ty = dy > 0 ? (H - M - a[1]) / dy : dy < 0 ? (top + M - a[1]) / dy : Infinity;
    const r = Math.min(tx, ty), ex = a[0] + dx * r, ey = a[1] + dy * r;
    const label = `${t.callsign} ${(distM([t.lon, t.lat], endOf(near.e)!.threshold) / NM).toFixed(1)} NM`;
    // label on the outward side of a parallel pair (L to the pilot's left), kept inside the map
    const side = near.e.endsWith("R") ? -1 : 1, nx = -dy * side, ny = dx * side, start = nx >= 0, tw = label.length * 8.7;
    const lx = Math.min(Math.max(ex + nx * 14 + (start ? 4 : -4), start ? 6 : 6 + tw), start ? W - 6 - tw : W - 6) - ex;
    const ly = Math.min(Math.max(ey + ny * 14 + 5, top + 18), H - 8) - ey;
    return (
      <g key={`edge-${t.id}`} transform={`translate(${ex.toFixed(1)},${ey.toFixed(1)})`} opacity={warn && !parties.has(t.id) ? 0.3 : 1}
        className="cursor-pointer" onClick={(ev) => { ev.stopPropagation(); onSelect?.(t.id === selectedTrackId ? null : t.id); }}>
        <path d={CHEVRON} transform={`rotate(${(t.heading - VIEW_BEARING).toFixed(1)}) scale(0.75)`} className={t.source === "simulated" || t.estimated ? "fill-ground stroke-ink" : "fill-ink stroke-ground"} strokeWidth={2} strokeLinejoin="round" />
        <text x={lx} y={ly} textAnchor={start ? "start" : "end"} fontSize={15} fontWeight={700} className="fill-ink stroke-ground" strokeWidth={4} paintOrder="stroke" strokeLinejoin="round">{label}</text>
      </g>
    );
  };

  const target = (t: Track) => {
    const involved = parties.has(t.id), selected = t.id === selectedTrackId;
    const label = labels.get(t.id), quiet = tiers.get(t.id) === 3, one = tiers.get(t.id) === 1;
    const sim = t.source === "simulated";
    const tags = [sim && "SIM", t.estimated && "EST"].filter((x): x is string => !!x);
    const hollow = sim || t.estimated;
    const look = hollow ? "fill-ground stroke-ink" : "fill-ink stroke-ground";
    const sk = quiet ? 0.65 * k : k; // parked traffic: small and faint (group opacity), so active traffic stands out
    const dash = t.estimated ? "4 3" : undefined;
    const anchor = label && ANCHOR[label.al];
    return (
      <g
        key={t.id}
        ref={(el) => { if (el) els.current.set(t.id, el); else els.current.delete(t.id); }}
        opacity={(warn && !involved ? 0.3 : 1) * (quiet ? 0.35 : 1)}
        role={hero ? undefined : "button"}
        tabIndex={hero ? undefined : 0}
        aria-label={hero ? undefined : [t.callsign, ...tags].join(" ")}
        aria-pressed={hero ? undefined : selected}
        className={hero ? undefined : "cursor-pointer"}
        onClick={hero ? undefined : (e) => { e.stopPropagation(); onSelect?.(selected ? null : t.id); }}
        onKeyDown={hero ? undefined : (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect?.(selected ? null : t.id); } }}
      >
        <circle data-pulse r={12} className="fill-none stroke-clear" strokeWidth={3} opacity={0} />
        {selected && <circle r={20} className="fill-none stroke-clear" strokeWidth={2} />}
        {t.kind === "aircraft" ? (
          <g data-rot><path d={CHEVRON} transform={`scale(${sk})`} className={look} strokeWidth={hollow ? 2.5 : 1.5} strokeDasharray={dash} strokeLinejoin="round" /></g>
        ) : (
          <rect x={-7 * sk} y={-7 * sk} width={14 * sk} height={14 * sk} className={look} strokeWidth={2.5} strokeDasharray={dash} />
        )}
        {label && (
          <g transform={`translate(${label.dx},${label.dy})`}>
            <text x={label.tags.length ? label.rx : 0} y={6} textAnchor={label.tags.length ? "start" : anchor} fontSize={one ? 17 : 15} fontWeight={700} className={`${one ? "fill-ink" : "fill-ink-2"} stroke-ground`} strokeWidth={4} paintOrder="stroke" strokeLinejoin="round">{t.callsign}</text>
            {label.tags.map((tag, i) => (
              <g key={tag} transform={`translate(${label.rx + label.cw + 6 + i * 36},-8)`}>
                <rect width={32} height={17} rx={2} className="fill-ground stroke-ink-2" strokeWidth={1.5} />
                <text x={16} y={9} textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={800} className="fill-ink-2">{tag}</text>
              </g>
            ))}
            {label.lines.map(([line, cls], i) => (
              <text key={i} y={28 + i * 20} textAnchor={anchor} fontSize={15} fontWeight={700} className={`${cls} stroke-ground`} strokeWidth={4} paintOrder="stroke" strokeLinejoin="round">{line}</text>
            ))}
          </g>
        )}
      </g>
    );
  };

  return (
    <div ref={box} className={`relative h-full w-full overflow-hidden ${hero ? "" : "bg-ground"}`}>
      <svg
        width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 select-none"
        aria-hidden={hero || undefined}
        aria-label={hero ? undefined : "SFO airfield, tower view"}
        onClick={hero ? undefined : () => onSelect?.(null)}
      >
        <defs>
          <marker id={`${uid}arrow`} viewBox="0 0 10 10" refX={6} refY={5} markerWidth={4} markerHeight={4} orient="auto">
            <path d="M0,0L10,5L0,10Z" className="fill-warn" />
          </marker>
        </defs>
        {staticLayer}

        {warn && (
          <g fill="none" strokeLinecap="round">
            {warn.zoneRunway && runwayOf(warn.zoneRunway) && (
              <path d={D([zonePolygon(warn.zoneRunway).map(project)], true)} className="fill-warn/20 stroke-warn" strokeWidth={3 * k} />
            )}
            {warn.paths.map((p, i) => p.length > 1 && (
              // paths[0] is the crossing (dashed), paths[1] the landing (solid)
              <path key={i} d={D([p.map(project)])} className="stroke-warn" strokeWidth={4 * k} strokeDasharray={i === 0 ? "10 7" : undefined} markerEnd={`url(#${uid}arrow)`} />
            ))}
            {pt && <circle cx={pt[0]} cy={pt[1]} r={14 * k} className="stroke-warn" strokeWidth={3 * k} />}
          </g>
        )}

        {pt && cd && (
          // leader from the ring edge to the panel centre, under the signs and targets; the panel (drawn last) covers its far end
          <path d={`M${pt[0]},${pt[1]}L${cd.x.toFixed(1)},${cd.y.toFixed(1)}`} className="stroke-warn" strokeWidth={3} strokeDasharray={`0 ${14 * k} 9999`} />
        )}
        {designators.map(({ name, x, y }) => (
          <text key={name} x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={15} fontWeight={700}
            className={`${arr.includes(name) || dep.includes(name) ? "fill-ink" : "fill-ink-2"} stroke-ground`} strokeWidth={4} paintOrder="stroke" strokeLinejoin="round"
            opacity={warn && !zoneEnds.includes(name) ? 0.3 : 1}>{name}</text>
        ))}
        {hold && <Sign x={hold.x} y={hold.y} text={hold.text} size={14} mand />}
        {[...twys].map(([ref, rwy]) => {
          const a = taxiwayAnchor(ref, rwy);
          if (!a) return null;
          const [x, y] = P(a);
          return <Sign key={ref} x={x} y={y} text={ref} size={14} dim={!!warn && ref !== alertCall?.clearance?.taxiway} />;
        })}

        {tracks?.map(target)}
        {tracks?.map(edgeMarker)}

        {cd && <Sign x={cd.x} y={cd.y} text={cd.text} size={20} warn />}
        <text x={W - 10} y={H - 10} textAnchor="end" fontSize={12} className="fill-ink-3">{ATTRIBUTION}</text>
      </svg>
    </div>
  );
}

export default AirfieldMap; // Landing imports the default
