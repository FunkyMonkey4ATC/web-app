// Pure helpers for the pipeline rail (self-check: npx tsx src/components/rail/format.check.ts).

export type Tok = { s: string; k: "key" | "str" | "num" | "lit" | "punc" };

/** Pretty JSON split into coloured tokens; joining every `s` gives back JSON.stringify(v, null, 2). */
export function jsonTokens(v: unknown): Tok[] {
  const src = JSON.stringify(v, null, 2) ?? "null";
  const re = /("(?:\\.|[^"\\])*")(?=\s*:)|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)/g;
  const out: Tok[] = [];
  let last = 0;
  for (let m; (m = re.exec(src)); last = re.lastIndex) {
    if (m.index > last) out.push({ s: src.slice(last, m.index), k: "punc" });
    out.push({ s: m[0], k: m[1] ? "key" : m[2] ? "str" : m[3] ? "num" : "lit" });
  }
  if (last < src.length) out.push({ s: src.slice(last), k: "punc" });
  return out;
}

/** Speech-shaped bar heights (0..1), the same every render for the same call id. */
export function waveform(id: string, n = 56): number[] {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const rand = () => { // mulberry32
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const bars: number[] = [];
  while (bars.length < n) {
    const word = 3 + Math.floor(rand() * 6);
    for (let k = 0; k < word && bars.length < n; k++) bars.push(0.3 + 0.7 * Math.sin((Math.PI * (k + 0.5)) / word) * (0.55 + 0.45 * rand()));
    for (let g = 1 + Math.floor(rand() * 2); g > 0 && bars.length < n; g--) bars.push(0.08);
  }
  return bars;
}

export const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
