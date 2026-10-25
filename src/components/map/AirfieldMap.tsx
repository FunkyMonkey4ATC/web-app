"use client";
// Airfield map drawn as SVG from the bundled OSM airfield in the tower-window view (sfo.project). No map library.
// Everything is drawn in screen pixels, so labels and strokes keep one size at every zoom.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Alert, Track, WorldState } from "@/lib/contract";
import {
  ATTRIBUTION, FEATURES, NM, RUNWAYS, VIEW_BEARING, approachLine, crossing, distM, endOf, offset, project, runwayOf, zonePolygon,
} from "@/lib/sfo";

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

function fieldBox(arr: string[]): XY[] {
  // 6 NM, not 5: scenario arrivals start ~6 NM out and should be on screen from their first call
  return [...RWYS.flat(), ...APRONS.flat(), ...TERMINALS.flat(), ...arr.filter((e) => endOf(e)).map((e) => project(approachLine(e, 6)[0]))];
}
function corridorBox(a: Alert): XY[] {
  const pts: LonLat[] = [...(a.zoneRunway && runwayOf(a.zoneRunway) ? zonePolygon(a.zoneRunway) : []), ...a.paths.flat(), ...(a.point ? [a.point] : [])];
  return pts.length ? pts.map(project) : INTERSECTION_BOX;
}
function fit(pts: XY[], w: number, h: number, pad: number): Frame {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const s = Math.min((w - 2 * pad) / Math.max(x1 - x0, 1), (h - 2 * pad) / Math.max(y1 - y0, 1));
  return { s, tx: w / 2 - (s * (x0 + x1)) / 2, ty: h / 2 - (s * (y0 + y1)) / 2 };
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
/** Location-sign panel (black field, yellow border + legend), or the red countdown panel. Width estimated from the legend. */
function Sign({ x, y, text, size = 15, warn, dim }: { x: number; y: number; text: string; size?: number; warn?: boolean; dim?: boolean }) {
  const w = signW(text, size), h = Math.round(size * 1.55);
  return (
    <g transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`} opacity={dim ? 0.3 : 1}>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={2} className={warn ? "fill-warn" : "fill-sign-black stroke-sign-yellow"} strokeWidth={warn ? 0 : 2} />
      <text textAnchor="middle" dominantBaseline="central" fontSize={size} fontWeight={800} className={warn ? "fill-sign-black" : "fill-sign-yellow"}>{text}</text>
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
  const warn = world?.alerts.find((a) => a.status === "active" && a.level === "warning" && a.banner);

  // Framing holds still for the life of an alert; it changes only with zoom, the alert itself, the config or the window.
  const pts = useMemo(
    () => (zoom === "corridor" ? (warn ? corridorBox(warn) : INTERSECTION_BOX) : fieldBox(arrKey.split(","))),
    [zoom, warn?.id, arrKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const f = useMemo(() => fit(pts, W, H, 56), [pts, W, H]);
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
    return (
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d={D(APRONS, true)} className="fill-apron" fillRule="evenodd" />
        <path d={D(TERMINALS, true)} className="fill-panel stroke-seam" strokeWidth={1} fillRule="evenodd" />
        <path d={D(TAXIWAYS)} className="stroke-taxiway" strokeWidth={Math.max(23 * f.s, 3) * k} />
        <path d={D(RWYS)} className="stroke-runway" strokeWidth={rwyW} strokeLinecap="butt" />
        <path d={D(RWYS)} className="stroke-paint" strokeWidth={1.5 * k} strokeDasharray="12 10" opacity={0.8} />
        <path d={D(HOLDS)} className="stroke-ink-2" strokeWidth={2.5 * k} />
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

  const target = (t: Track) => {
    const involved = parties.has(t.id), selected = t.id === selectedTrackId;
    const showLabel = hero ? involved : true;
    const sim = t.source === "simulated";
    const tags = [sim && "SIM", t.estimated && "EST"].filter((x): x is string => !!x);
    const strip = selected ? world?.strips.find((s) => s.trackId === t.id) : undefined;
    const look = sim || t.estimated ? "fill-ground stroke-ink" : "fill-ink stroke-ground";
    const dash = t.estimated ? "4 3" : undefined;
    const details = selected ? [[t.type ?? strip?.type, `${Math.round(t.speed_kt)} kt`].filter(Boolean).join(" · "), strip?.clearance] : [];
    return (
      <g
        key={t.id}
        ref={(el) => { if (el) els.current.set(t.id, el); else els.current.delete(t.id); }}
        opacity={warn && !involved ? 0.3 : 1}
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
          <g data-rot><path d={CHEVRON} transform={`scale(${k})`} className={look} strokeWidth={sim || t.estimated ? 2.5 : 1.5} strokeDasharray={dash} strokeLinejoin="round" /></g>
        ) : (
          <rect x={-7 * k} y={-7 * k} width={14 * k} height={14 * k} className={look} strokeWidth={2.5} strokeDasharray={dash} />
        )}
        {showLabel && (
          <g transform={`translate(${16 * k},0)`}>
            <text y={6} fontSize={17} fontWeight={700} className="fill-ink stroke-ground" strokeWidth={4} paintOrder="stroke" strokeLinejoin="round">{t.callsign}</text>
            {tags.map((tag, i) => (
              <g key={tag} transform={`translate(${i * 36},14)`}>
                <rect width={32} height={17} rx={2} className="fill-ground stroke-ink-2" strokeWidth={1.5} />
                <text x={16} y={9} textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={800} className="fill-ink-2">{tag}</text>
              </g>
            ))}
            {details.filter(Boolean).map((line, i) => (
              <text key={i} y={(tags.length ? 48 : 28) + i * 20} fontSize={15} className={`${i ? "fill-clear" : "fill-ink-2"} stroke-ground`} strokeWidth={4} paintOrder="stroke">{line}</text>
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

        {!hero && RUNWAYS.flatMap((r, i) => r.ends.map((e, j) => {
          const [ax, ay] = P(RWYS[i][j]), [bx, by] = P(RWYS[i][1 - j]), len = Math.hypot(ax - bx, ay - by) || 1;
          const ux = (ax - bx) / len, uy = (ay - by) / len; // out past the threshold
          const side = e.name.endsWith("L") ? 16 : e.name.endsWith("R") ? -16 : 0; // parallel pairs: L sign to the pilot's left, R to the right
          return <Sign key={e.name} x={ax + ux * 22 - uy * side} y={ay + uy * 22 + ux * side} text={e.name} dim={!!warn && !zoneEnds.includes(e.name)} />;
        }))}
        {[...twys].map(([ref, rwy]) => {
          const a = taxiwayAnchor(ref, rwy);
          if (!a) return null;
          const [x, y] = P(a);
          return <Sign key={ref} x={x} y={y} text={ref} size={14} dim={!!warn && ref !== alertCall?.clearance?.taxiway} />;
        })}

        {tracks?.map(target)}

        {pt && warn?.countdown && (
          // below the conflict point: arrivals come in from the top of the tower view
          <g>
            <path d={`M${pt[0]},${pt[1] + 14 * k}V${pt[1] + 34}`} className="stroke-warn" strokeWidth={3} />
            <Sign x={Math.min(Math.max(pt[0], signW(warn.countdown.label, 20) / 2 + 8), W - signW(warn.countdown.label, 20) / 2 - 8)} y={pt[1] + 50} text={warn.countdown.label} size={20} warn />
          </g>
        )}
        <text x={W - 10} y={H - 10} textAnchor="end" fontSize={12} className="fill-ink-3">{ATTRIBUTION}</text>
      </svg>
    </div>
  );
}

export default AirfieldMap; // Landing imports the default
