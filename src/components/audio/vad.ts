// Energy voice activity detector with hysteresis. Pure, so it can be checked without a microphone.
export const ONSET_MS = 300, RELEASE_MS = 700, MAX_MS = 12_000;
const BLIP_MS = 150; // a click or cough dies out within this during onset

export interface Vad { floor: number; phase: "idle" | "onset" | "speech"; t0: number; quietSince: number | null }
export const newVad = (): Vad => ({ floor: 0.005, phase: "idle", t0: 0, quietSince: null });

/** Feed one RMS frame; says what the recorder should do now. */
export function vadStep(v: Vad, rms: number, now: number): "start" | "confirm" | "drop" | "finish" | null {
  // Noise floor falls at once and rises slowly, so steady room noise stops counting as speech.
  v.floor = rms < v.floor ? rms : v.floor + (rms - v.floor) * 0.003;
  const loud = rms > Math.max(0.02, v.floor * 3), quiet = rms < Math.max(0.01, v.floor * 1.5);
  v.quietSince = quiet ? v.quietSince ?? now : null;
  const quietMs = v.quietSince === null ? 0 : now - v.quietSince;

  if (v.phase === "idle") {
    if (!loud) return null;
    v.phase = "onset"; v.t0 = now;
    return "start"; // recording starts at the first loud frame so the first word is kept
  }
  if (v.phase === "onset") {
    if (quietMs >= BLIP_MS) { v.phase = "idle"; return "drop"; }
    if (now - v.t0 < ONSET_MS || quiet) return null;
    v.phase = "speech";
    return "confirm";
  }
  if (quietMs >= RELEASE_MS || now - v.t0 >= MAX_MS) { v.phase = "idle"; return "finish"; }
  return null;
}
