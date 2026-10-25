// Internal interfaces between the engine lanes. Isomorphic: no Node-only imports anywhere under src/engine.
// The engine runs inside the custom server on the GB10, and inside the browser when no server socket exists (Vercel).
import type {
  AgentAlert, Alert, Call, Clearance, Conflict, Iso, OperatorCommand, OutboxItem, ScenarioId, Strip, Track, Weather, WorldState,
} from "@/lib/contract";

// ---- Lane: sim (src/engine/sim/*) ----
/** A radio call as the recording or a scenario script provides it, before the pipeline runs. */
export interface RawCall {
  id: string;
  t: Iso;
  endT: Iso;
  freq: Call["freq"];
  speaker: Clearance["speaker"];
  from: string;
  to: string;
  text: string;                     // the words spoken (typed transcript)
  audio?: string;                   // "/audio/<file>" served from public/audio
  source: "replay" | "scenario";
  scripted?: Omit<Clearance, "t" | "audio">; // ground-truth parse, used by the mock parser and for eval
}
export interface Sim {
  load(scenario: ScenarioId, ending?: "without" | "with"): void;
  startT(): Iso;
  endT(): Iso;                      // replay loops or stops here
  frame(simT: Iso): { tracks: Track[]; weather: Weather };
  callsBetween(fromT: Iso, toT: Iso): RawCall[]; // calls whose start t is in (fromT, toT]
  jumpTarget(name: "before_crossing"): Iso | null;
  config(): { arr: string[]; dep: string[] };
  label(): string;
}
export type CreateSim = () => Sim;

// ---- Lane: airfield (src/engine/airfield.ts) ----
/** Latest standing clearance per callsign (low-confidence calls never enter this). */
export type ActiveClearances = Record<string, { clearance: Clearance; callId: string }>;

/** What the checker found; the engine turns it into an Alert (id, latency, status, reasoning). */
export interface Detection {
  key: string;                      // stable while the same conflict persists, e.g. "crossing_on_landing_runway|28L|BYL646|RESCUE9"
  conflict: Conflict;
  level: Alert["level"];
  text: string;
  detail: string;
  partyTrackIds: string[];
  zoneRunway?: string;
  paths: [number, number][][];
  point?: [number, number];
  countdown?: Alert["countdown"];
  banner: boolean;
  triggerCallId?: string;           // the call whose end starts the latency clock
}
export interface Airfield {
  applyClearance(active: ActiveClearances, clearance: Clearance, callId: string): void;
  checkCall(call: Call, world: WorldState, active: ActiveClearances): Call["rules"]; // pass/fail + why for every rule, shown in the rail
  evaluate(world: WorldState, active: ActiveClearances): Detection[];               // run every second
  deriveStrips(world: WorldState, active: ActiveClearances): Strip[];
  weatherStatus(weather: Weather, config: WorldState["config"]): WorldState["weatherStatus"];
}
export type CreateAirfield = () => Airfield;

// ---- Lane: pipeline + agents (src/engine/pipeline.ts, parser.ts, agents.ts) ----
export interface AgentPort {
  mode: "mock" | "live";
  transcribe(input: { callId: string; typed?: string; audio?: ArrayBuffer; mime?: string; audioUrl?: string }): Promise<{ text: string; ms: number }>;
  parse(text: string, ctx: { callId: string; t: Iso; freq: Call["freq"]; speaker: Clearance["speaker"]; scripted?: RawCall["scripted"] }): Promise<{ clearance: Clearance | null; ms: number }>;
  judge(conflict: Conflict, ctx: { alertId: string; text: string; evidence: Call[] }): Promise<{ severity: "high" | "medium" | "low"; text?: string; reasoning: string; ms: number; outbox: OutboxItem["status"] }>;
}
/** Runs one call through stt -> parse -> link, calling onUpdate after each stage so the rail card fills in live. */
export type RunCall = (raw: RawCall, deps: { agent: AgentPort; tracks: Track[]; threshold: number; onUpdate: (c: Call) => void }) => Promise<Call>;

// ---- Lane: engine (src/engine/engine.ts) ----
export interface Engine {
  getWorld(): WorldState;
  subscribe(fn: (w: WorldState) => void): () => void; // fires after every tick (4 Hz) and every change
  command(c: OperatorCommand): void;
  feedback(alertId: string, response: "ack" | "false_alarm"): void;
  agentAlert(a: AgentAlert): void;                    // Chris's agent posting a finished alert back
  micUtterance(audio: ArrayBuffer, mime: string): Promise<void>;
  live(update: { tracks: Track[]; weather?: Weather }): void; // latest live ADS-B frame (and METAR), used while scenario is "live"
  start(): void;
  stop(): void;
}
export type CreateEngine = (opts: { agent: AgentPort; network: "offline" | "online" }) => Engine;
