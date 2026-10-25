import assert from "node:assert/strict";
import { jsonTokens, secs, waveform } from "./format";

const c = { t: "2026-03-23T03:36:44Z", callsign: "RESCUE9", action: "cross_runway", runway: "28L", confidence: 0.92, note: 'say "P:"', x: null, ok: true, n: -1e-7 };
const toks = jsonTokens(c);
assert.equal(toks.map((t) => t.s).join(""), JSON.stringify(c, null, 2));
assert.deepEqual(toks.filter((t) => t.k === "key").map((t) => t.s), Object.keys(c).map((k) => `"${k}"`));
assert.deepEqual(toks.find((t) => t.s === '"say \\"P:\\""'), { s: '"say \\"P:\\""', k: "str" });
assert.deepEqual(toks.filter((t) => t.k === "num").map((t) => t.s), ["0.92", "-1e-7"]);
assert.deepEqual(toks.filter((t) => t.k === "lit").map((t) => t.s), ["null", "true"]);
assert.deepEqual(jsonTokens(undefined), [{ s: "null", k: "lit" }]);

const w = waveform("call_0042");
assert.equal(w.length, 56);
assert.deepEqual(w, waveform("call_0042"));
assert.notDeepEqual(w, waveform("call_0043"));
assert.ok(w.every((x) => x > 0 && x <= 1));

assert.equal(secs(1080), "1.1 s");
console.log("rail format: ok");
