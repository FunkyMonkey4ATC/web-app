// Regex parser from ATC radio text to a Clearance. Stand-in for Chris's parser; also fills gaps in a live parse.
import type { Action, Clearance, Iso } from "@/lib/contract";

const DIGIT: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", tree: "3", four: "4", five: "5", fife: "5",
  six: "6", seven: "7", eight: "8", nine: "9", niner: "9",
};
const TELEPHONY: Record<string, string> = {
  bayline: "BYL", "fog express": "FGX", tamal: "TML", rescue: "RESCUE", ops: "OPS",
  united: "UAL", american: "AAL", delta: "DAL", alaska: "ASA", southwest: "SWA", skywest: "SKW",
};
const PHONETIC = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu";
const ACTIONS: [Action, RegExp][] = [
  ["clear_of_runway", /\bclear of\b/],
  ["cleared_to_land", /\bcleared to land\b/],
  ["cleared_for_takeoff", /\bcleared for take ?off\b/],
  ["line_up_and_wait", /\blin(?:e|ing) up and wait/],
  ["hold_short", /\bhold(?:ing)? short\b/],
  ["cross_runway", /\bcross(?:ing)?\b/],
  ["stop", /\b(?:hold(?:ing)? position|stop)\b/],
  ["taxi", /\btaxi(?:ing)?\b/],
];
const NEEDS_RUNWAY: Action[] = ["cleared_to_land", "cleared_for_takeoff", "line_up_and_wait", "cross_runway"];
const GARBLE = /\.\.\.|…|--|\[|\?|\b(?:uh|um|er)\b|say again|unintelligible|inaudible/g;

const CALLSIGN_RE = new RegExp(`\\b(${Object.keys(TELEPHONY).join("|")})\\s+(\\d{1,4})\\b`);
const TAXIWAY_RE = new RegExp(`\\b(?:at|via|taxiway)\\s+(${PHONETIC.replace(/ /g, "|")})(?:\\s+(\\d))?\\b`);
const RUNWAY_RE = /\b0?(\d{1,2})\s*(left|right|center)\b/; // every SFO runway has a side, so "wind 280 at 12" never reads as one

function first(x: string): Action | undefined {
  let best: Action | undefined, at = Infinity;
  for (const [a, re] of ACTIONS) { const i = x.search(re); if (i >= 0 && i < at) { at = i; best = a; } }
  return best;
}
const runwayIn = (x: string) => { const m = x.match(RUNWAY_RE); return m ? m[1] + m[2][0].toUpperCase() : undefined; };
const taxiwayIn = (x: string) => { const m = x.match(TAXIWAY_RE); return m ? m[1][0].toUpperCase() + (m[2] ?? "") : undefined; };

/** null when the text holds no instruction (tower) and nothing recognisable (pilot). */
export function parseText(text: string, ctx: { t: Iso; speaker: Clearance["speaker"] }): Clearance | null {
  const raw = text.toLowerCase();
  const s = raw
    .replace(/\b(zero|one|two|three|tree|four|five|fife|six|seven|eight|nine|niner)\b/g, (w) => DIGIT[w])
    .replace(/\b\d+(?:\s+\d+)+\b/g, (m) => m.replace(/\s+/g, "")); // "two eight" -> "28", never across a comma
  const tail = s.split(/\bcorrection\b/).pop()!; // after "correction" the corrected words win
  const cm = s.match(CALLSIGN_RE);
  const callsign = cm ? TELEPHONY[cm[1]] + cm[2] : "";
  const found = first(tail) ?? first(s);
  const controller = ctx.speaker === "tower" || ctx.speaker === "ground";
  if (controller ? !found : !found && !callsign) return null;
  const action: Action = controller ? found! : found === "clear_of_runway" ? found : "readback";
  const runway = runwayIn(tail) ?? runwayIn(s);
  const taxiway = taxiwayIn(tail) ?? taxiwayIn(s);

  let c = 0.95;
  if (!callsign) c -= 0.3;
  if (!found) c -= 0.2;
  if (!runway && (NEEDS_RUNWAY.includes(action) || /\brunway\b/.test(s))) c -= 0.25; // runway said or required, number unreadable
  c -= 0.1 * (raw.match(GARBLE)?.length ?? 0);
  if (tail !== s) c -= 0.05;

  return {
    t: ctx.t, speaker: ctx.speaker, callsign, action,
    ...(runway && { runway }), ...(taxiway && { taxiway }),
    confidence: Math.max(0.05, Math.round(c * 100) / 100),
  };
}
