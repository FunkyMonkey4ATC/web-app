// Synthesizes every scripted radio call to public/audio/<id>.wav with macOS `say`, and writes data/audio-manifest.json.
// Run: npx tsx scripts/make-audio.ts [--force]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSim } from "../src/engine/sim";
import type { RawCall } from "../src/engine/types";

const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "public/audio");
const force = process.argv.includes("--force");
const runs = [["normal"], ["incident", "without"], ["incident", "with"], ["no_clearance"], ["visibility"]] as const;

const sim = createSim();
const calls = new Map<string, RawCall>();
for (const [scenario, ending] of runs) {
  sim.load(scenario, ending);
  const from = new Date(Date.parse(sim.startT()) - 1).toISOString(); // callsBetween excludes fromT; keep a call at t=0
  for (const c of sim.callsBetween(from, sim.endT())) calls.set(c.id, c);
}

mkdirSync(OUT, { recursive: true });
const manifest: Record<string, string> = { _note: "synthesized stand-ins (macOS say); replace with real recordings of the same ids" };
let made = 0;
for (const c of calls.values()) {
  if (!/^[\w.-]+$/.test(c.id)) throw new Error(`call id not a safe file name: ${c.id}`);
  const file = join(OUT, `${c.id}.wav`);
  manifest[c.id] = `/audio/${c.id}.wav`;
  if (existsSync(file) && !force) continue;
  const voice = c.speaker === "tower" || c.speaker === "ground" ? "Samantha" : "Reed (English (US))";
  // text on stdin so a line starting with "-" is never read as a flag
  execFileSync("say", ["-v", voice, "-r", "185", "--data-format=LEI16@16000", "-o", file, "-f", "-"], { input: c.text });
  made++;
}
writeFileSync(join(ROOT, "data/audio-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`${calls.size} calls, ${made} synthesized, ${calls.size - made} kept -> public/audio, data/audio-manifest.json`);
