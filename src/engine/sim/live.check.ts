// Self-check for the live feed converters and the engine's live mode: npx tsx src/engine/sim/live.check.ts
import { NM, TOWER, distM } from "@/lib/sfo";
import { createEngine } from "@/engine/engine";
import { createMockAgent } from "@/engine/agents";
import { adsbLolToTracks, metarToWeather, openskyToTracks } from "./live";
// one real recorder snapshot (the first frame of sfo-recording.json) and the METAR fetched with it
import adsb from "../../../data/recording/sfo/positions/20261025T211220Z_adsblol.json";
import opensky from "../../../data/recording/sfo/positions/20261025T211220Z_opensky.json";
import metar from "../../../data/recording/sfo/weather/20261025T211220Z_metar.json";
import recording from "./sfo-recording.json";

const ok = (cond: unknown, msg: string) => { if (!cond) throw new Error(msg); };
const T = "2026-10-25T21:12:20.000Z";

const tracks = adsbLolToTracks(adsb, T), byId = new Map(tracks.map((t) => [t.id, t]));
ok(tracks.length > 20 && tracks.every((t) => t.source === "live" && t.t === T), `adsb.lol: ${tracks.length} tracks`);
ok(tracks.every((t) => (t.alt_ft ?? 0) <= 4000 && distM([t.lon, t.lat], [TOWER.lon, TOWER.lat]) <= 8 * NM), "adsb.lol: outside the 8 NM / 4000 ft box");
ok(!byId.has("ad14a0") && !byId.has("a652df"), "adsb.lol: 10625 ft and 11 NM aircraft must be dropped");
ok(byId.get("a1c7e4")?.callsign === "UAL871" && byId.get("a1c7e4")?.alt_ft === 0 && byId.get("a1c7e4")?.type === "B77W", "adsb.lol: ground aircraft, trimmed callsign");
ok(byId.get("a1d2dc")?.callsign === "N2165J", "adsb.lol: no flight -> registration");
ok(byId.get("a64a40")?.kind === "vehicle" && tracks.filter((t) => t.kind === "vehicle").length === 1, "adsb.lol: OPS39 (C1, SERV) is the one vehicle");
const recorded = new Set(recording.frames[0].tracks.map((r) => r[0]));
ok(tracks.every((t) => recorded.has(t.id)), "adsb.lol: same filtering as scripts/build-recording.ts");

const os = openskyToTracks(opensky, T);
ok(os.length > 10 && os.every((t) => t.source === "live" && recorded.has(t.id)), `OpenSky: ${os.length} tracks`);
ok(os.find((t) => t.id === "ab5dd4")?.callsign === "UAL433", "OpenSky: trimmed callsign");

const wx = metarToWeather(metar)!;
ok(wx.source === "live" && wx.metar.startsWith("METAR KSFO 252056Z") && wx.t === "2026-10-25T20:56:00.000Z", `METAR: newest report ${wx.metar}`);
ok(wx.wind_dir === 50 && wx.wind_kt === 3 && wx.visibility_sm === 10 && wx.ceiling_ft === 20000, `METAR fields ${JSON.stringify(wx)}`);
ok(metarToWeather([]) === undefined && adsbLolToTracks({}, T).length === 0 && openskyToTracks({ states: null }, T).length === 0, "empty feeds");

// engine: live follows the wall clock, shows the latest frame, runs no scripted calls, and goes back to the replay
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
void (async () => {
  const e = createEngine({ agent: createMockAgent(), network: "offline" });
  e.command({ cmd: "scenario", value: "live" });
  let w = e.getWorld();
  ok(w.clock.scenario === "live" && w.tracks.length === 0 && w.calls.length === 0 && w.alerts.length === 0 && w.weather.source === "recorded", "live before any data");
  e.live({ tracks, weather: wx });
  e.start();
  await sleep(1200);
  w = e.getWorld();
  ok(Math.abs(Date.parse(w.clock.simT) - Date.now()) < 1000 && w.clock.playing, `live clock ${w.clock.simT}`);
  ok(w.tracks.length === tracks.length && w.weather.metar === wx.metar, "live frame shown");
  ok(w.ui.network === "online" && w.calls.length === 0 && w.strips.length > 0, "live: online, no scripted calls, strips");
  e.command({ cmd: "pause" });
  ok(e.getWorld().clock.playing, "live never pauses");
  e.command({ cmd: "scenario", value: "normal" });
  await sleep(300);
  w = e.getWorld();
  e.stop();
  ok(w.tracks.some((t) => t.source === "recorded") && w.ui.network === "offline" && Date.parse(w.clock.simT) <= Date.parse(recording.endT), "back to the replay");
  console.log(`live: ${tracks.length} adsb.lol tracks, ${os.length} OpenSky tracks, weather ${wx.metar.slice(0, 40)}, engine live mode ok`);
})().catch((err) => { console.error(err); process.exit(1); });
