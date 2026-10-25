import assert from "node:assert/strict";
import { MAX_MS, newVad, vadStep } from "./vad";

// Runs frames at 30 ms (the mic loop's rate) and returns [event, time] pairs.
function run(segments: [rms: number, ms: number][]) {
  const v = newVad(), out: [string, number][] = [];
  let t = 0;
  for (const [rms, ms] of segments) for (const end = t + ms; t < end; t += 30) {
    const ev = vadStep(v, rms, t);
    if (ev) out.push([ev, t]);
  }
  return out;
}
const names = (e: [string, number][]) => e.map(([n]) => n);

// One spoken call: start at once, confirm after ~300 ms, finish ~700 ms into the silence.
const call = run([[0.002, 1000], [0.1, 2000], [0.002, 1500]]);
assert.deepEqual(names(call), ["start", "confirm", "finish"]);
assert.ok(call[1][1] - call[0][1] >= 300 && call[1][1] - call[0][1] < 360);
assert.ok(call[2][1] - 3000 >= 700 && call[2][1] - 3000 < 760);

// A click is recorded, then dropped; never confirmed.
assert.deepEqual(names(run([[0.002, 500], [0.2, 60], [0.002, 1000]])), ["start", "drop"]);

// A short gap between words does not end the utterance.
assert.deepEqual(names(run([[0.002, 500], [0.1, 1000], [0.002, 300], [0.1, 1000], [0.002, 1500]])), ["start", "confirm", "finish"]);

// Talking without pause is cut at the 12 s cap.
const long = run([[0.002, 500], [0.1, 20_000]]);
assert.equal(long.find(([n]) => n === "finish")![1] - long[0][1] <= MAX_MS, true);

// Steady room noise yields at most one utterance before the floor adapts.
assert.ok(names(run([[0.002, 500], [0.03, 60_000]])).filter((n) => n === "finish").length <= 1);

console.log("audio vad: ok");
