// The one shared contract. Server lanes and UI lanes import only from here.
// Event shapes (Clearance, Track, Weather, Conflict) match the Linear hub doc data contract.

export type Iso = string; // UTC ISO timestamp, replay (sim) time

export type Action =
  | "cleared_to_land" | "cleared_for_takeoff" | "line_up_and_wait" | "cross_runway"
  | "hold_short" | "taxi" | "stop" | "readback" | "clear_of_runway";

export interface Clearance {
  t: Iso;
  speaker: "tower" | "ground" | "pilot" | "vehicle";
  callsign: string;           // "RESCUE9", "BYL646"
  action: Action;
  runway?: string;            // "28L"
  taxiway?: string;           // "P"
  confidence: number;         // 0..1
  audio?: string;             // "/audio/clip_0042.wav"
}

export interface Track {
  t: Iso;
  id: string;
  kind: "aircraft" | "vehicle";
  callsign: string;
  lat: number;
  lon: number;
  speed_kt: number;
  heading: number;
  source: "recorded" | "simulated";
  type?: string;              // "A320", "VEH"
  alt_ft?: number;            // undefined or 0 on the ground
  estimated?: boolean;        // radio-only vehicle placed from its last clearance (EST)
}

export interface Weather {
  t: Iso;
  metar: string;
  wind_dir: number;
  wind_kt: number;
  visibility_sm: number;
  ceiling_ft: number | null;
  source: "recorded" | "simulated";
}

export type RuleId =
  | "crossing_on_landing_runway"    // 1: crossing/takeoff clearance on a runway with a landing clearance not yet clear
  | "runway_incursion_no_clearance" // 2: aircraft/vehicle inside a runway zone with no matching clearance
  | "weather_below_minimums"        // 3: weather below landing minimums for the arrival runway
  | "readback_mismatch";            // 4: readback runway/taxiway differs from the instruction (caution)

export interface Conflict {
  t: Iso;
  rule: RuleId;
  runway: string;
  parties: string[];          // callsigns
  evidence: string[];         // audio clip paths and/or call ids
  severity_hint: "high" | "medium" | "low";
}

// ---- Pipeline record for one radio call (drives strips, caption and the demo rail) ----

export interface Stage { ms: number; ok: boolean; note?: string }

export interface RuleResult { rule: RuleId; pass: boolean; why: string } // why: "28L has no landing clearance"

export interface Call {
  id: string;
  t: Iso;                     // call start
  endT: Iso;                  // call end (alert latency is measured from here)
  freq: "TWR" | "GND";
  speaker: Clearance["speaker"];
  from: string;               // "TWR" or a callsign
  to: string;                 // callsign or "TWR"
  transcript: string;         // what the speech model heard (or typed fallback, silently)
  audio?: string;
  source: "replay" | "scenario" | "mic";
  stages: { stt?: Stage; parse?: Stage; link?: Stage; check?: Stage; judge?: Stage };
  clearance?: Clearance;
  lowConfidence: boolean;     // confidence < world.ui.threshold: amber, rules don't fire on it
  linkedTrackId?: string;
  linkNote?: string;          // "radio only, estimated at P hold-short"
  rules: RuleResult[];
  readbackOf?: string;        // call id of the instruction this reads back
  verdict?: "ok" | "caution" | "warning";
  alertId?: string;
}

export interface Alert {
  id: string;
  t: Iso;
  level: "warning" | "caution";
  conflict: Conflict;
  text: string;               // plain sentence: "Rescue 9 is crossing runway 28L while Bayline 646 is landing on it."
  detail: string;             // "Rule 1 · crossing clearance on a landing runway"
  reasoning?: string;         // judge model's short explanation (demo rail)
  severity?: "high" | "medium" | "low";
  latencyMs: number | null;   // call end -> alert shown
  callId?: string;
  partyTrackIds: string[];
  zoneRunway?: string;        // runway zone to fill on the map
  paths: [number, number][][];// [lon,lat] polylines: crossing path, landing path
  point?: [number, number];   // [lon,lat] conflict point
  countdown?: { label: string; seconds: number }; // "BYL646 at P in 14 s"
  status: "active" | "resolved";
  response?: "ack" | "false_alarm";
  banner: boolean;            // false for weather (panel only) - still goes to the agent/Slack
}

export type Bay = "arriving" | "on_runway" | "holding_short" | "taxi_out" | "taxi_in" | "at_gate" | "departed";
export const BAY_ORDER: Bay[] = ["arriving", "on_runway", "holding_short", "taxi_out", "taxi_in", "at_gate"];
export const BAY_LABEL: Record<Bay, string> = {
  arriving: "Arriving", on_runway: "On runway", holding_short: "Holding short",
  taxi_out: "Taxi out", taxi_in: "Taxi in", at_gate: "At gate", departed: "Departed",
};

export interface Strip {
  trackId: string;
  callsign: string;
  kind: Track["kind"];
  type?: string;
  bay: Bay;
  clearance?: string;         // ATC shorthand: "CLRD LAND 28L", "XING 28L @P", "LUAW 1L", "H/S 28L", "TAXI L → 1L"
  clearanceT?: Iso;
  distanceNm?: number;        // arrivals: to threshold
  speedKt?: number;
  source: Track["source"];
  estimated: boolean;
  radioOnly: boolean;
  confidence?: number;        // set only when the last clearance was low confidence
  state: "normal" | "caution" | "warning";
  lastCallT?: Iso;            // strips sort newest call first within a bay
  gate?: string;              // simulated gate number (SIM)
}

export type ScenarioId = "normal" | "incident" | "no_clearance" | "visibility";
export const SCENARIO_LABEL: Record<ScenarioId, string> = {
  normal: "Normal traffic",
  incident: "LaGuardia sequence, restaged at SFO",
  no_clearance: "Vehicle enters a runway with no clearance",
  visibility: "Visibility drops below minimums",
};

export interface OutboxItem { alertId: string; t: Iso; text: string; status: "queued" | "sent" | "failed" | "mock" }

export interface WorldState {
  clock: {
    simT: Iso;
    playing: boolean;
    speed: 1 | 2 | 4;
    scenario: ScenarioId;
    ending?: "without" | "with"; // incident only: first pass hides the alert, second pass shows it
  };
  config: { arr: string[]; dep: string[]; overridden: boolean };
  weather: Weather;
  weatherStatus: { runway: string; belowMinimums: boolean; headwindKt: number; crosswindKt: number; minimums: { ceiling_ft: number; visibility_sm: number } };
  tracks: Track[];
  strips: Strip[];
  calls: Call[];              // newest first, at most 40
  alerts: Alert[];            // active first, then the last 10 resolved
  caption: { callId: string; freq: Call["freq"]; from: string; to: string; text: string; t: Iso } | null;
  stats: { calls: number; clearances: number; lowConfidence: number; alerts: number; falseAlarms: number; medianLatencyMs: number | null };
  outbox: OutboxItem[];
  ui: { railOpen: boolean; threshold: number; agentMode: "mock" | "live"; network: "offline" | "online"; micListening: boolean };
}

// ---- Wire protocol ----
// Server -> browser over WebSocket at ws://<host>/ws : { type: "world", world } at ~4 Hz and on every change.
export type ServerMessage = { type: "world"; world: WorldState };

// Browser -> server over HTTP (handled by the custom server, before Next):
// POST /api/operator  OperatorCommand
// POST /api/feedback  { alertId: string; response: "ack" | "false_alarm" }
// POST /api/alerts    AgentAlert            (Chris's agent posts finished alerts here)
// POST /api/mic       audio/webm body       (one utterance from the always-on mic)
export type OperatorCommand =
  | { cmd: "play" } | { cmd: "pause" } | { cmd: "restart" } | { cmd: "reset" }
  | { cmd: "speed"; value: 1 | 2 | 4 }
  | { cmd: "scenario"; value: ScenarioId; ending?: "without" | "with" }
  | { cmd: "jump"; value: "before_crossing" }
  | { cmd: "rail"; value: boolean }
  | { cmd: "threshold"; value: number }
  | { cmd: "config"; arr: string[]; dep: string[] };

export interface AgentAlert {
  alertId?: string;           // echo of the id web-app sent with the conflict
  conflict?: Conflict;
  severity: "high" | "medium" | "low";
  text: string;
  reasoning?: string;
  outbox?: "queued" | "sent" | "failed";
}

export const ZULU = (iso: Iso) => iso.slice(11, 19) + "Z";
/** Station codes as people read them: "TWR" -> "Tower", "GND" -> "Ground"; callsigns pass through. */
export const spoken = (who: string) => ({ TWR: "Tower", GND: "Ground" } as Record<string, string>)[who] ?? who;
