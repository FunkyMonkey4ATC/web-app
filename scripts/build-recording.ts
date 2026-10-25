// Merges the raw SFO recording (OpenSky + adsb.lol snapshots, KSFO METAR) into src/engine/sim/sfo-recording.json.
// Re-runnable while the recorder is still writing: npx tsx scripts/build-recording.ts
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NM, TOWER, distM } from "../src/lib/sfo";

const ROOT = join(__dirname, "..");
const POS = join(ROOT, "data/recording/sfo/positions");
const WX = join(ROOT, "data/recording/sfo/weather");
const AUDIO = join(ROOT, "public/audio");
const OUT = join(ROOT, "src/engine/sim/sfo-recording.json");

type Row = [string, string, number, number, number, number, number, string, number];
const read = (p: string) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }; // a file mid-write is skipped
const stampMs = (f: string) => {
  const m = f.match(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z/)!;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
};

const types = new Map<string, string>();
const frames: { t: string; tracks: Row[] }[] = [];
let last = -Infinity;
for (const stamp of [...new Set(readdirSync(POS).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, 16)))].sort()) {
  const t = stampMs(stamp);
  if (t - last < 10_000) continue;
  const rows = new Map<string, Row>();
  const add = (hex: string, cs: string, lat: number, lon: number, alt: number, kt: number, hdg: number, type: string, vehicle: number) => {
    if (alt > 4000 || distM([lon, lat], [TOWER.lon, TOWER.lat]) > 8 * NM) return;
    if (type) types.set(hex, type);
    rows.set(hex, [hex, cs, +lat.toFixed(5), +lon.toFixed(5), Math.max(0, Math.round(alt / 25) * 25), Math.round(kt), Math.round(hdg), type, vehicle]);
  };
  // adsb.lol first (type, ground flag); OpenSky only fills aircraft adsb.lol did not see
  for (const a of read(join(POS, `${stamp}_adsblol.json`))?.ac ?? []) {
    const alt = a.alt_baro === "ground" ? 0 : a.alt_baro;
    if (a.lat == null || typeof alt !== "number" || (a.seen_pos ?? 0) > 60) continue;
    add(a.hex, (a.flight ?? "").trim() || a.r || a.hex, a.lat, a.lon, alt, a.gs ?? 0, a.track ?? a.true_heading ?? 0, a.t ?? "", /^C/.test(a.category ?? "") ? 1 : 0);
  }
  for (const s of read(join(POS, `${stamp}_opensky.json`))?.states ?? []) {
    const [hex, cs, , tpos, , lon, lat, baroM, onGround, vel, trk] = s;
    if (rows.has(hex) || lat == null || t / 1000 - tpos > 60) continue;
    add(hex, (cs ?? "").trim() || hex, lat, lon, onGround ? 0 : (baroM ?? 0) * 3.28084, (vel ?? 0) * 1.94384, trk ?? 0, "", s[17] === 16 || s[17] === 17 ? 1 : 0);
  }
  if (!rows.size) continue;
  frames.push({ t: new Date(t).toISOString(), tracks: [...rows.values()] });
  last = t;
}
for (const f of frames) for (const r of f.tracks) r[7] ||= types.get(r[0]) ?? "";

const metars = new Map<string, string>();
for (const f of readdirSync(WX).filter((f) => f.endsWith("_metar.json")))
  for (const m of read(join(WX, f)) ?? []) metars.set(new Date(m.obsTime * 1000).toISOString(), m.rawOb);

if (!frames.length || !metars.size) throw new Error("recording has no position frames or no METAR");
const audio = existsSync(AUDIO) ? readdirSync(AUDIO).filter((f) => f.endsWith(".wav")).map((f) => f.slice(0, -4)) : [];
const json = JSON.stringify({
  startT: frames[0].t,
  endT: frames[frames.length - 1].t,
  fields: ["id", "callsign", "lat", "lon", "alt_ft", "speed_kt", "heading", "type", "vehicle"],
  frames,
  metars: [...metars].sort().map(([t, metar]) => ({ t, metar })),
  audio,
});
writeFileSync(OUT, json);
console.log(`${frames.length} frames ${frames[0].t} -> ${frames[frames.length - 1].t}, ${metars.size} METAR, ${audio.length} audio, ${(json.length / 1e6).toFixed(2)} MB`);
