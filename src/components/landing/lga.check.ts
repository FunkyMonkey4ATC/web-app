// Self-check for LgaIncident geometry and timeline: npx tsx src/components/landing/lga.check.ts
import assert from "node:assert/strict";
import { LGA } from "./LgaIncident";

const { project, rc, X_D, S_D, LEN, HOLD_E, HOLD_W, START, STOP, LOOP, T_ALERT, T_D, LEAD, jazzAlong, truckAt } = LGA;
const HALF_W = 23; // runway 4 pavement half-width, m

assert.ok(X_D, "taxiway D crosses runway 4");
const x = rc(X_D);
assert.ok(Math.abs(x.off) < 1 && x.along > 0 && x.along < LEN, "D crossing lies on the runway 4 centerline");
assert.ok(Math.hypot(X_D[0] - project([-73.8787, 40.7755])[0], X_D[1] - project([-73.8787, 40.7755])[1]) < 60, "D crossing near 40.7755,-73.8787");
assert.ok(HOLD_E && HOLD_W && HOLD_E !== HOLD_W && rc(HOLD_E).off * rc(HOLD_W).off < 0, "hold-short lines on both sides of D");

const stop = Math.abs(rc(STOP).off), hold = Math.abs(rc(HOLD_E).off);
assert.ok(stop > HALF_W, `truck stops off the pavement (${stop.toFixed(1)} m > ${HALF_W} m)`);
assert.ok(stop < hold, `truck stops inside the hold-short (${stop.toFixed(1)} m < ${hold.toFixed(1)} m)`);
assert.ok(Math.abs(rc(START).off) > hold, "truck starts behind the hold line");

let closest = Infinity, prevJ = -Infinity;
for (let t = 0; t <= LOOP; t += 0.01) {
  closest = Math.min(closest, Math.abs(rc(truckAt(t)).off));
  const j = jazzAlong(t);
  assert.ok(j >= prevJ, "Jazz 646 never reverses");
  prevJ = j;
}
assert.ok(closest > HALF_W && Math.abs(closest - stop) < 0.01, "truck never enters the runway");
assert.ok(Math.abs(jazzAlong(T_D) - S_D) < 0.5, "Jazz 646 reaches D at T_D");
assert.ok(jazzAlong(T_ALERT) < S_D && jazzAlong(LOOP) < LEN, "Jazz 646 stays on runway 4");
assert.equal(LEAD, Math.round(T_D - T_ALERT));
console.log(`ok: D at ${S_D.toFixed(0)} m from the 4 threshold, truck stops ${stop.toFixed(1)} m off centerline (hold ${hold.toFixed(1)} m), Jazz starts ${(-jazzAlong(0) / 1852).toFixed(2)} NM out, alert lead ${LEAD} s`);
