// npx tsx src/engine/plausible.check.ts  (cases are real transcripts from a live SFO session)
import assert from "node:assert";
import { plausible } from "./agents";
const t = (c: object, h: string) => plausible(c, h);
assert(t({ callsign: "UAL1176", runway: "28L" }, "united one one seven six runway two eight left cleared to land"));
assert(t({ callsign: "RESCUE9", runway: "28L" }, "Rescue nine cross runway two eight left at papa"));
assert(t({ callsign: "ASA91", runway: "28L" }, "Um, ASA 91 you are clear to go on 28L"));
assert(!t({ callsign: "BYL646", taxiway: "P" }, "one"));                       // invented from nothing
assert(!t({ callsign: "RUNWAY331ALFAPAPA", runway: "331" }, "runway three three one alfa papa thank you very much for"));
assert(!t({ callsign: "AIRBERLIN875" }, "air berlin eight seven five request decei"));
assert(!t({ callsign: "UAL1176", runway: "27" }, "united one one seven six runway two seven"));  // not an SFO runway
console.log("plausible ok");
