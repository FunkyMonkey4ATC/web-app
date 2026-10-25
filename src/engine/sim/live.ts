// Live SFO feeds to contract shapes: adsb.lol (OpenSky as fallback) positions and the aviationweather.gov METAR. Pure, isomorphic.
import type { Iso, Track, Weather } from "@/lib/contract";
import { NM, TOWER, distM } from "@/lib/sfo";

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
// same box as scripts/build-recording.ts: within 8 NM of the tower, at or below 4000 ft
const near = (lon: number, lat: number, alt: number) => alt <= 4000 && distM([lon, lat], [TOWER.lon, TOWER.lat]) <= 8 * NM;
const track = (t: Iso, id: string, callsign: string, lat: number, lon: number, alt: number, kt: number, hdg: number, type: string, vehicle: boolean): Track => ({
  t, id, kind: vehicle ? "vehicle" : "aircraft", callsign, lat, lon, speed_kt: Math.round(kt), heading: Math.round(hdg),
  source: "live", ...(type && { type }), alt_ft: Math.max(0, Math.round(alt)),
});

/** https://api.adsb.lol/v2/point/<lat>/<lon>/<nm> -> tracks near SFO. */
export function adsbLolToTracks(json: unknown, isoNow: Iso): Track[] {
  const ac = (json as { ac?: unknown })?.ac, out: Track[] = [];
  for (const a of Array.isArray(ac) ? (ac as Record<string, unknown>[]) : []) {
    const alt = a.alt_baro === "ground" ? 0 : a.alt_baro, hex = text(a.hex), type = text(a.t);
    if (!hex || !num(a.lat) || !num(a.lon) || !num(alt) || (num(a.seen_pos) ? a.seen_pos : 0) > 60 || !near(a.lon, a.lat, alt)) continue;
    const hdg = num(a.track) ? a.track : num(a.true_heading) ? a.true_heading : 0;
    const vehicle = /^C[12]$/.test(text(a.category)) || type === "GRND" || type === "SERV";
    out.push(track(isoNow, hex, text(a.flight) || text(a.r) || hex, a.lat, a.lon, alt, num(a.gs) ? a.gs : 0, hdg, type, vehicle));
  }
  return out;
}

/** https://opensky-network.org/api/states/all?<bbox> -> tracks near SFO (state vector indices per the OpenSky docs). */
export function openskyToTracks(json: unknown, isoNow: Iso): Track[] {
  const states = (json as { states?: unknown })?.states, now = Date.parse(isoNow) / 1000, out: Track[] = [];
  for (const s of Array.isArray(states) ? (states as unknown[][]) : []) {
    const [hex, cs, , tpos, , lon, lat, baroM, onGround, vel, trk] = s, id = text(hex);
    const alt = onGround === true ? 0 : num(baroM) ? baroM * 3.28084 : NaN;
    if (!id || !num(lat) || !num(lon) || !num(alt) || !num(tpos) || now - tpos > 60 || !near(lon, lat, alt)) continue;
    out.push(track(isoNow, id, text(cs) || id, lat, lon, alt, num(vel) ? vel * 1.94384 : 0, num(trk) ? trk : 0, "", s[17] === 16 || s[17] === 17));
  }
  return out;
}

/** https://aviationweather.gov/api/data/metar?ids=KSFO&format=json -> the newest report, or undefined. */
export function metarToWeather(json: unknown): Weather | undefined {
  const reports = (Array.isArray(json) ? json : []) as Record<string, unknown>[];
  const m = reports.filter((r) => text(r?.rawOb)).sort((a, b) => (num(b.obsTime) ? b.obsTime : 0) - (num(a.obsTime) ? a.obsTime : 0))[0];
  if (!m) return undefined;
  const bases = (Array.isArray(m.clouds) ? (m.clouds as Record<string, unknown>[]) : [])
    .filter((c) => /^(BKN|OVC|OVX|VV)$/.test(text(c?.cover)) && num(c.base)).map((c) => c.base as number);
  return {
    t: new Date(num(m.obsTime) ? m.obsTime * 1000 : Date.now()).toISOString(),
    metar: text(m.rawOb),
    wind_dir: num(m.wdir) ? m.wdir : 0, // "VRB" reads as 0, as in the replay's METAR parser
    wind_kt: num(m.wspd) ? m.wspd : 0,
    visibility_sm: num(m.visib) ? m.visib : parseFloat(String(m.visib ?? "10")) || 0, // "10+" -> 10
    ceiling_ft: bases.length ? Math.min(...bases) : null,
    source: "live",
  };
}
