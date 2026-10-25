"use client";
// Landing hero: a looping reconstruction of the LaGuardia runway 4 sequence (March 22, 2026). Two actors, one alert.
// Real LGA geometry from OpenStreetMap, drawn like AirfieldMap. Motion is time-based, so it is frame-rate independent.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import geo from "../../../data/lga-airfield.json";

type LonLat = [number, number];
type XY = [number, number];
type Frame = { s: number; tx: number; ty: number };
type Feature = { properties: { aeroway?: string; ref?: string }; geometry: { type: string; coordinates: unknown } };
const FEATURES = (geo as { features: Feature[] }).features;
const NM = 1852;

// Equirectangular metres around the LGA tower, north-up, y pointing down the screen.
const R = 6371008.8, D2R = Math.PI / 180, LAT0 = 40.7734, LON0 = -73.8736, COS0 = Math.cos(LAT0 * D2R);
const project = ([lon, lat]: LonLat): XY => [(lon - LON0) * D2R * R * COS0, -(lat - LAT0) * D2R * R];
const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lerp = (a: XY, b: XY, k: number): XY => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
function segX([a, b]: [XY, XY], [c, d]: [XY, XY]): XY | null {
  const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
  if (Math.abs(den) < 1e-6) return null;
  const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
  const u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? lerp(a, b, t) : null;
}
const segs = (ls: XY[][]) => ls.flatMap((l) => l.slice(1).map((p, i): [XY, XY] => [l[i], p]));
const lines = (aeroway: string, ref?: string) =>
  FEATURES.filter((f) => f.properties.aeroway === aeroway && f.geometry.type === "LineString" && (!ref || f.properties.ref === ref))
    .map((f) => (f.geometry.coordinates as LonLat[]).map(project));
const polys = (aeroway: string) =>
  FEATURES.filter((f) => f.properties.aeroway === aeroway && f.geometry.type === "Polygon")
    .flatMap((f) => (f.geometry.coordinates as LonLat[][]).map((r) => r.map(project)));
const APRONS = polys("apron"), TERMINALS = polys("terminal"), TAXIWAYS = lines("taxiway"), HOLDS = lines("holding_position");

// Runways threshold to threshold; at LGA the west end carries the first designator (4, 13).
const RUNWAYS = FEATURES.filter((f) => f.properties.aeroway === "runway").map((f) => {
  const c = (f.geometry.coordinates as LonLat[]).map(project), a = c[0], b = c[c.length - 1];
  const [w, e] = a[0] < b[0] ? [a, b] : [b, a];
  const [n1, n2] = f.properties.ref!.split("/").map((n) => String(Number(n)));
  return { ref: f.properties.ref!, ends: [{ name: n1, p: w }, { name: n2, p: e }] };
});

// Runway 4 coordinates: along = metres from the runway 4 threshold toward 22, off = metres to the pilot's left.
const R4 = RUNWAYS.find((r) => r.ref === "04/22")!;
const THR = R4.ends[0].p, END = R4.ends[1].p, LEN = dist(THR, END);
const U: XY = [(END[0] - THR[0]) / LEN, (END[1] - THR[1]) / LEN];
const NL: XY = [U[1], -U[0]];
const at = (along: number, off = 0): XY => [THR[0] + U[0] * along + NL[0] * off, THR[1] + U[1] * along + NL[1] * off];
const rc = (p: XY) => {
  const dx = p[0] - THR[0], dy = p[1] - THR[1];
  return { along: dx * U[0] + dy * U[1], off: dx * NL[0] + dy * NL[1] };
};
const HDG = Math.atan2(U[0], -U[1]) / D2R; // runway 4 true track (~32 deg) = screen rotation, north-up

// Taxiway D across runway 4, and its hold-short lines either side (OSM breaks the east line at D, so each is stretched 3 m).
const D_SEGS = segs(lines("taxiway", "D"));
const X_D = D_SEGS.map((s) => segX([THR, END], s)).find((p): p is XY => !!p)!;
const S_D = rc(X_D).along;
const stretch = ([a, b]: [XY, XY]): [XY, XY] => { const k = 3 / (dist(a, b) || 1); return [lerp(a, b, -k), lerp(b, a, -k)]; };
const HOLD_D = segs(HOLDS).map(stretch).flatMap((h) => D_SEGS.map((s) => segX(h, s)))
  .filter((p): p is XY => !!p && dist(p, X_D) < 150).sort((a, b) => b[0] - a[0]);
const HOLD_E = HOLD_D[0], HOLD_W = HOLD_D[HOLD_D.length - 1]; // Rescue 35 waits on the east (terminal) side

// Rescue 35 runs along D from just behind the east hold line and stops 60 m off the centerline: past the hold line, well clear of the 46 m pavement.
const toE = (m: number): XY => lerp(X_D, HOLD_E, m / dist(X_D, HOLD_E));
const START = toE(dist(X_D, HOLD_E) + 7);
const STOP = toE((60 / Math.abs(rc(HOLD_E).off)) * dist(X_D, HOLD_E));

// ---- Timeline (s) ----
const LOOP = 30;
const T_CROSS = 3.5; // "Cross runway 4 at Delta." spoken 3.5 to 5 s
const T_GO = 5; // Rescue 35 rolls when the call ends
const T_ALERT = 6; // Ground Truth, 1 s after the call ends
const T_HOLD = 9; // "Hold position." spoken 9 to 10 s
const T_BRAKE = 10, T_STOP = 11;
const T_D = 25; // Jazz 646 reaches taxiway D
const LEAD = Math.round(T_D - T_ALERT);

// Jazz 646: 140 kt on final, touchdown 300 m past the threshold, 2 m/s2 rollout, timed to reach D at T_D.
const V0 = 72, DECEL = 2, S_TD = 300;
const T_TD = T_D - (V0 - Math.sqrt(V0 * V0 - 2 * DECEL * (S_D - S_TD))) / DECEL;
function jazzAlong(t: number) {
  if (t <= T_TD) return S_TD - V0 * (T_TD - t);
  const r = Math.min(t - T_TD, V0 / DECEL);
  return S_TD + V0 * r - (DECEL * r * r) / 2;
}
// Rescue 35: accelerate 1.5 s, cruise, brake 1 s after the hold call to stop exactly at STOP.
const RUN = dist(START, STOP), T_ACC = 1.5, VT = RUN / (T_BRAKE - T_GO - T_ACC / 2 + (T_STOP - T_BRAKE) / 2);
function truckAt(t: number): XY {
  let d = 0;
  if (t >= T_BRAKE) { const b = Math.min(t, T_STOP) - T_BRAKE; d = VT * (T_BRAKE - T_GO - T_ACC / 2) + VT * b - (VT * b * b) / (2 * (T_STOP - T_BRAKE)); }
  else if (t >= T_GO + T_ACC) d = VT * (t - T_GO - T_ACC / 2);
  else if (t > T_GO) d = (VT * (t - T_GO) ** 2) / (2 * T_ACC);
  return lerp(START, STOP, d / RUN);
}

/** For lga.check.ts. */
export const LGA = { project, rc, X_D, S_D, LEN, HOLD_E, HOLD_W, START, STOP, LOOP, T_ALERT, T_D, LEAD, jazzAlong, truckAt };

// ---- Drawing ----
// Wide screens: the arrival's whole path and all of runway 4/22; narrow ones crop so the crossing stays large.
const framePts = (from: number, to = S_D + 250): XY[] => [at(from), at(to), START, HOLD_W];
function fit(pts: XY[], [x0, y0, x1, y1]: number[]): Frame {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const a = Math.min(...xs), b = Math.max(...xs), c = Math.min(...ys), d = Math.max(...ys);
  const s = Math.max(0.01, Math.min((x1 - x0) / (b - a), (y1 - y0) / (d - c)));
  return { s, tx: (x0 + x1) / 2 - (s * (a + b)) / 2, ty: (y0 + y1) / 2 - (s * (c + d)) / 2 };
}
const px = (f: Frame, p: XY): XY => [p[0] * f.s + f.tx, p[1] * f.s + f.ty];
const pathD = (f: Frame, ls: XY[][], close = false) =>
  ls.map((l) => "M" + l.map((p) => px(f, p).map((n) => n.toFixed(1)).join(",")).join("L") + (close ? "Z" : "")).join("");
const CHEVRON = "M0,-12L9,9L0,4L-9,9Z"; // points up = north
const halo = { strokeWidth: 4, paintOrder: "stroke", strokeLinejoin: "round" } as const;

function Sign({ x, y, text, mand }: { x: number; y: number; text: string; mand?: boolean }) {
  const size = 16, w = Math.round(text.length * size * 0.6 + size), h = Math.round(size * 1.55);
  return (
    <g transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`}>
      {mand && <rect x={-w / 2 - 3} y={-h / 2 - 3} width={w + 6} height={h + 6} rx={3} className="fill-sign-black" />}
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={2} className={mand ? "fill-warn-sign stroke-white" : "fill-sign-black stroke-sign-yellow"} strokeWidth={2} />
      <text textAnchor="middle" dominantBaseline="central" fontSize={size} fontWeight={800} className={mand ? "fill-white" : "fill-sign-yellow"}>{text}</text>
    </g>
  );
}

export function LgaIncident({ className }: { className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const box = useRef<HTMLDivElement>(null);
  const [[W, H], setSize] = useState<XY>([1200, 700]);
  const [t, setT] = useState(0);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => { if (e.contentRect.width > 10) setSize([e.contentRect.width, e.contentRect.height]); });
    ro.observe(box.current!);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setT(T_ALERT); return; } // one still frame: the alert
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => { setT(((now - t0) / 1000) % LOOP); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // The corridor runs bottom-left to top-right, so on wide screens the card floats in the empty top-left; narrow ones keep a band for it.
  // Side margins leave room for JZA646 (labelled left) and RESCUE 35 (labelled right).
  const wide = W >= 768; // same breakpoint as the card's @3xl container query
  const f = useMemo(
    () => (wide ? fit(framePts(jazzAlong(0) - 60, LEN + 80), [104, 24, W - 120, H - 64]) : fit(framePts(-450), [80, Math.min(236, H * 0.3), W - 112, H - 64])),
    [W, H, wide],
  );
  const P = (p: XY) => px(f, p);

  const staticLayer = useMemo(() => {
    const P = (p: XY) => px(f, p);
    const rw = RUNWAYS.map((r) => [r.ends[0].p, r.ends[1].p]);
    const [x0, y0] = P(THR), [x2, y2] = P(at(-2 * NM));
    const l = Math.hypot(x2 - x0, y2 - y0) || 1, nx = (-(y2 - y0) / l) * 9, ny = ((x2 - x0) / l) * 9;
    const ticks = [1, 2].map((n) => { const [x, y] = P(at(-n * NM)); return `M${(x - nx).toFixed(1)},${(y - ny).toFixed(1)}L${(x + nx).toFixed(1)},${(y + ny).toFixed(1)}`; });
    return (
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d={pathD(f, APRONS, true)} className="fill-raised" fillRule="evenodd" />
        <path d={pathD(f, TERMINALS, true)} className="fill-seam" fillRule="evenodd" />
        <path d={pathD(f, TAXIWAYS)} className="stroke-taxiway" strokeWidth={Math.max(23 * f.s, 3)} />
        <path d={pathD(f, rw)} className="stroke-runway" strokeWidth={Math.max(46 * f.s, 7)} strokeLinecap="butt" />
        <path d={pathD(f, rw)} className="stroke-paint" strokeWidth={1.5} strokeDasharray="12 10" opacity={0.8} />
        <path d={pathD(f, HOLDS)} className="stroke-ink-3" strokeWidth={1.25} opacity={0.7} />
        <path d={`M${x0.toFixed(1)},${y0.toFixed(1)}L${x2.toFixed(1)},${y2.toFixed(1)}${ticks.join("")}`} className="stroke-ink-3" strokeWidth={1.5} />
        {RUNWAYS.flatMap((r) => r.ends.map((e, j) => {
          // plain designator just past the threshold, to the landing pilot's right: clear of the final line and the arrival's label
          const [ax, ay] = P(e.p), [bx, by] = P(r.ends[1 - j].p), len = Math.hypot(ax - bx, ay - by) || 1;
          const ux = (ax - bx) / len, uy = (ay - by) / len, hw = e.name.length * 5.5 + 3, hh = 10;
          const along = hw * Math.abs(ux) + hh * Math.abs(uy) + 8, out = hw * Math.abs(uy) + hh * Math.abs(ux) + 4;
          return (
            <text key={e.name} x={ax + ux * along + uy * out} y={ay + uy * along - ux * out} textAnchor="middle" dominantBaseline="central"
              fontSize={18} fontWeight={700} className="fill-ink-2 stroke-ground" {...halo}>{e.name}</text>
          );
        }))}
      </g>
    );
  }, [f]);

  const alert = t >= T_ALERT && t < T_D, done = t >= T_D;
  const fade = Math.max(0, Math.min(1, t / 0.6, (LOOP - t) / 1.2));
  const tr = truckAt(t), [jx, jy] = P(at(jazzAlong(t))), [tx, ty] = P(tr), [cx, cy] = P(X_D), [hx, hy] = P(HOLD_E);
  const airborne = 1 + 0.3 * Math.max(0, (T_TD - t) / T_TD); // a touch larger while still descending
  const zone = [at(-15, 70), at(LEN + 15, 70), at(LEN + 15, -70), at(-15, -70)];
  const [to, said] = t < T_CROSS ? ["Jazz 646", "Runway 4, cleared to land."] : t < T_HOLD ? ["Rescue 35", "Cross runway 4 at Delta."] : ["Rescue 35", "Hold position."];
  const card = "absolute left-4 right-4 top-[52px] rounded bg-panel/95 p-4 @3xl:right-auto @3xl:top-[60px] @3xl:w-[min(27.5rem,30%)]";

  return (
    <div ref={box} role="img" className={`@container relative overflow-hidden ${className ?? ""}`}
      aria-label={`Reconstruction of the LaGuardia runway 4 sequence, March 22, 2026: Ground Truth flags Rescue 35 crossing runway 4 while Jazz 646 is landing, ${LEAD} s before Jazz 646 reaches taxiway D.`}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 select-none" aria-hidden>
        <defs>
          <marker id={`${uid}a`} viewBox="0 0 10 10" refX={6} refY={5} markerWidth={4} markerHeight={4} orient="auto">
            <path d="M0,0L10,5L0,10Z" className="fill-warn" />
          </marker>
        </defs>
        {staticLayer}
        <g opacity={fade}>
          {alert && (
            <g fill="none" strokeLinecap="round">
              <path d={pathD(f, [zone], true)} className="fill-warn/15 stroke-warn" strokeWidth={3} />
              <path d={`M${jx.toFixed(1)},${jy.toFixed(1)}L${cx.toFixed(1)},${cy.toFixed(1)}`} className="stroke-warn" strokeWidth={4} markerEnd={`url(#${uid}a)`} />
              <path d={pathD(f, [[tr, X_D, HOLD_W]])} className="stroke-warn" strokeWidth={4} strokeDasharray="10 7" markerEnd={`url(#${uid}a)`} />
              <circle cx={cx} cy={cy} r={14} className="stroke-warn" strokeWidth={3} />
            </g>
          )}
          <Sign x={hx + 34} y={hy - 24} text="D" />
          {alert && <Sign x={hx} y={hy + 28} text="4-22" mand />}
          <g transform={`translate(${tx.toFixed(1)},${ty.toFixed(1)})`}>
            <rect x={-6.5} y={-6.5} width={13} height={13} className="fill-ink stroke-ground" strokeWidth={1.5} />
            <text x={14} y={6} fontSize={17} fontWeight={700} className="fill-ink stroke-ground" {...halo}>RESCUE 35</text>
          </g>
          <g transform={`translate(${jx.toFixed(1)},${jy.toFixed(1)})`}>
            <path d={CHEVRON} transform={`rotate(${HDG.toFixed(1)}) scale(${airborne.toFixed(3)})`} className="fill-ink stroke-ground" strokeWidth={1.5} strokeLinejoin="round" />
            <text x={-18} y={6} textAnchor="end" fontSize={17} fontWeight={700} className="fill-ink stroke-ground" {...halo}>JZA646</text>
          </g>
        </g>
      </svg>

      <div aria-hidden>
        <p className="absolute left-4 top-4 text-[16px] text-ink-3">Reconstruction · LaGuardia, March 22, 2026</p>
        {alert && (
          <div className={`${card} border-2 border-warn`}>
            <p className="text-[22px] font-bold leading-snug text-ink">Rescue 35 is crossing runway 4 while Jazz 646 is landing on it.</p>
            <p className="mt-3">
              <span className="inline-block rounded-sm bg-warn px-2 py-1 text-[20px] font-extrabold text-sign-black">Jazz 646 at D in {Math.ceil(T_D - t)} s</span>
            </p>
          </div>
        )}
        {done && (
          <p className={`${card} border border-seam text-[20px] text-ink`} style={{ opacity: fade }}>
            Alerted <strong>{LEAD} s</strong> before Jazz 646 reached taxiway D.
          </p>
        )}
        <p className="absolute bottom-4 left-4 right-4 text-[18px] text-ink-2" style={{ opacity: fade }}>
          Tower → {to}: <span className="text-ink">“{said}”</span>
        </p>
      </div>
    </div>
  );
}
