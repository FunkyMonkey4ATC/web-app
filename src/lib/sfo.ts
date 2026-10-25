// SFO airfield geometry and projection. Isomorphic: imported by the engine (server or browser) and the map.
import geo from "../../data/sfo-airfield.json";

type LonLat = [number, number];
type Feature = { properties: { aeroway: string; ref?: string; name?: string }; geometry: { type: string; coordinates: unknown } };
export const FEATURES = (geo as { features: Feature[] }).features;
export const ATTRIBUTION = "© OpenStreetMap contributors";

export const AIRPORT = "KSFO";
export const TOWER = { lat: 37.6159, lon: -122.3838 };
export const VIEW_BEARING = 61; // tower cab looking at the runway complex; this compass bearing points up on screen

const R = 6371008.8;
const D2R = Math.PI / 180;
const COS0 = Math.cos(TOWER.lat * D2R);
const SIN_B = Math.sin(VIEW_BEARING * D2R);
const COS_B = Math.cos(VIEW_BEARING * D2R);
export const NM = 1852;

/** Local metres east/north of the tower. */
export function toEN([lon, lat]: LonLat): [number, number] {
  return [(lon - TOWER.lon) * D2R * R * COS0, (lat - TOWER.lat) * D2R * R];
}
export function fromEN([e, n]: [number, number]): LonLat {
  return [TOWER.lon + e / (D2R * R * COS0), TOWER.lat + n / (D2R * R)];
}
/** Screen metres (x right, y down) in the tower-window view. */
export function project(p: LonLat): [number, number] {
  const [e, n] = toEN(p);
  return [e * COS_B - n * SIN_B, -(e * SIN_B + n * COS_B)];
}
export function distM(a: LonLat, b: LonLat): number {
  const [ae, an] = toEN(a), [be, bn] = toEN(b);
  return Math.hypot(ae - be, an - bn);
}
export function bearingDeg(a: LonLat, b: LonLat): number {
  const [ae, an] = toEN(a), [be, bn] = toEN(b);
  return (Math.atan2(be - ae, bn - an) / D2R + 360) % 360;
}
/** Point `m` metres from `p` along compass bearing `deg`. */
export function offset(p: LonLat, deg: number, m: number): LonLat {
  const [e, n] = toEN(p);
  return fromEN([e + Math.sin(deg * D2R) * m, n + Math.cos(deg * D2R) * m]);
}

// ---- Runways ----
export interface RunwayEnd { name: string; threshold: LonLat; heading: number } // heading = landing/takeoff direction from this end
export interface Runway { id: string; ends: [RunwayEnd, RunwayEnd]; widthM: number; lengthM: number }

function buildRunways(): Runway[] {
  const byRef = new Map<string, LonLat[]>();
  for (const f of FEATURES) {
    if (f.properties.aeroway !== "runway" || !f.properties.ref) continue;
    byRef.set(f.properties.ref, [...(byRef.get(f.properties.ref) ?? []), ...(f.geometry.coordinates as LonLat[])]);
  }
  return [...byRef].map(([ref, pts]) => {
    let a = pts[0], b = pts[1], best = 0;
    for (const p of pts) for (const q of pts) { const d = distM(p, q); if (d > best) { best = d; a = p; b = q; } }
    const [n1, n2] = ref.split("/").map((s) => s.replace(/^0/, ""));
    const hAB = bearingDeg(a, b);
    // the end you land from heads toward the other end; "28L" heads ~280
    const firstIsA = Math.abs(((hAB - parseInt(n1) * 10 + 540) % 360) - 180) < 90;
    const [t1, t2] = firstIsA ? [a, b] : [b, a];
    return {
      id: ref.replace(/^0/, "").replace("/0", "/"),
      ends: [
        { name: n1, threshold: t1, heading: bearingDeg(t1, t2) },
        { name: n2, threshold: t2, heading: bearingDeg(t2, t1) },
      ],
      widthM: 61,
      lengthM: best,
    } satisfies Runway;
  });
}
export const RUNWAYS: Runway[] = buildRunways(); // ids: "10L/28R", "10R/28L", "1R/19L", "1L/19R"

export function runwayOf(name: string): Runway | undefined {
  return RUNWAYS.find((r) => r.ends.some((e) => e.name === name) || r.id === name);
}
export function endOf(name: string): RunwayEnd | undefined {
  return runwayOf(name)?.ends.find((e) => e.name === name);
}

/** Runway zone half-width: hold-short lines sit ~85 m (280 ft) from the centerline at SFO. */
export const ZONE_HALF_WIDTH_M = 85;
const ZONE_END_EXTENSION_M = 60;

/** Position relative to a runway: metres along from ends[0] threshold, and signed metres off the centerline. */
export function runwayCoords(p: LonLat, rwy: Runway): { along: number; off: number } {
  const [ae, an] = toEN(rwy.ends[0].threshold), [be, bn] = toEN(rwy.ends[1].threshold), [pe, pn] = toEN(p);
  const ux = (be - ae) / rwy.lengthM, uy = (bn - an) / rwy.lengthM;
  return { along: (pe - ae) * ux + (pn - an) * uy, off: -(pe - ae) * uy + (pn - an) * ux };
}
export function inZone(p: LonLat, runwayIdOrEnd: string): boolean {
  const rwy = runwayOf(runwayIdOrEnd);
  if (!rwy) return false;
  const { along, off } = runwayCoords(p, rwy);
  return Math.abs(off) <= ZONE_HALF_WIDTH_M && along >= -ZONE_END_EXTENSION_M && along <= rwy.lengthM + ZONE_END_EXTENSION_M;
}
export function zonePolygon(runwayIdOrEnd: string): LonLat[] {
  const rwy = runwayOf(runwayIdOrEnd)!;
  const [a, b] = rwy.ends;
  const back = offset(a.threshold, b.heading, ZONE_END_EXTENSION_M), fwd = offset(b.threshold, a.heading, ZONE_END_EXTENSION_M);
  const left = (a.heading + 270) % 360, right = (a.heading + 90) % 360;
  return [offset(back, left, ZONE_HALF_WIDTH_M), offset(fwd, left, ZONE_HALF_WIDTH_M), offset(fwd, right, ZONE_HALF_WIDTH_M), offset(back, right, ZONE_HALF_WIDTH_M)];
}
/** Final approach centerline for a landing end, from `nm` out to the threshold. */
export function approachLine(endName: string, nm = 5): [LonLat, LonLat] {
  const e = endOf(endName)!;
  return [offset(e.threshold, (e.heading + 180) % 360, nm * NM), e.threshold];
}
/** Distance in NM from a point to a landing threshold. */
export function toThresholdNm(p: LonLat, endName: string): number {
  return distM(p, endOf(endName)!.threshold) / NM;
}

// ---- Taxiway crossings ----
function segX(p1: [number, number], p2: [number, number], p3: [number, number], p4: [number, number]): [number, number] | null {
  const den = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0]);
  if (Math.abs(den) < 1e-9) return null;
  const t = ((p1[0] - p3[0]) * (p3[1] - p4[1]) - (p1[1] - p3[1]) * (p3[0] - p4[0])) / den;
  const u = -((p1[0] - p2[0]) * (p1[1] - p3[1]) - (p1[1] - p2[1]) * (p1[0] - p3[0])) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])] : null;
}
/** Where taxiway `ref` crosses a runway centerline, e.g. crossing("28L", "P"). */
export function crossing(runwayIdOrEnd: string, ref: string): LonLat | null {
  const rwy = runwayOf(runwayIdOrEnd);
  if (!rwy) return null;
  const a = toEN(rwy.ends[0].threshold), b = toEN(rwy.ends[1].threshold);
  for (const f of FEATURES) {
    if (f.properties.aeroway !== "taxiway" || f.properties.ref !== ref || f.geometry.type !== "LineString") continue;
    const c = f.geometry.coordinates as LonLat[];
    for (let i = 0; i < c.length - 1; i++) {
      const x = segX(a, b, toEN(c[i]), toEN(c[i + 1]));
      if (x) return fromEN(x);
    }
  }
  return null;
}

/** Headwind/crosswind components (kt) for a runway end. */
export function windComponents(windDir: number, windKt: number, endName: string): { headwindKt: number; crosswindKt: number } {
  const e = endOf(endName);
  if (!e || !windKt) return { headwindKt: 0, crosswindKt: 0 };
  const a = (windDir - e.heading) * D2R;
  return { headwindKt: Math.round(windKt * Math.cos(a)), crosswindKt: Math.round(Math.abs(windKt * Math.sin(a))) };
}
