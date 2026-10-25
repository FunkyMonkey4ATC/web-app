// Agent adapters: the scripted mock (offline default) and Chris's HTTP agent, which falls back to the mock on any failure.
import type { Action, Clearance, Conflict, OutboxItem } from "@/lib/contract";
import type { AgentPort } from "./types";
import { normCallsign, parseText } from "./parser";

// Budgets sized so a hung agent still leaves time for the rule-1 alert; the judge runs after the alert is up.
const MS = { stt: 3000, parse: 2000, judge: 8000 };
const COOLDOWN_MS = 30_000; // after any failure the mock answers for a while, so a hung agent costs one slow call, not every call
const now = () => performance.now();
const since = (t0: number) => Math.round(now() - t0);
const sleep = (lo: number, hi: number) => new Promise<void>((r) => setTimeout(r, lo + Math.random() * (hi - lo)));

/** Two sentences built only from the conflict's own facts. */
export function reasoning(c: Conflict): string {
  const who = c.parties.join(" and ") || "Traffic", rw = c.runway;
  const [fact, why] = {
    crossing_on_landing_runway: [`${who} hold clearances that conflict on runway ${rw}: a crossing or takeoff was cleared while a landing clearance there is still active`, "the landing traffic has not cleared the runway"],
    runway_incursion_no_clearance: [`${who} entered the runway ${rw} zone and no clearance for it was heard on frequency`, "the runway was entered without permission"],
    weather_below_minimums: [`Reported weather is below the landing minimums for runway ${rw}`, "the ceiling or visibility is under the demo minimums"],
    readback_mismatch: [`The readback from ${who} does not match the instruction for runway ${rw}`, "the instruction and the readback name different places"],
  }[c.rule];
  return `${fact}. ${c.severity_hint[0].toUpperCase() + c.severity_hint.slice(1)} severity because ${why}.`;
}

export function createMockAgent(): AgentPort {
  return {
    mode: "mock",
    async transcribe({ typed }) {
      const t0 = now();
      await sleep(350, 500);
      return { text: typed ?? "", ms: since(t0) };
    },
    async parse(text, ctx) {
      const t0 = now();
      await sleep(80, 120);
      return { clearance: ctx.scripted ? { ...ctx.scripted, t: ctx.t } : parseText(text, ctx), ms: since(t0) };
    },
    async judge(conflict) {
      const t0 = now();
      await sleep(600, 900);
      return { severity: conflict.severity_hint, reasoning: reasoning(conflict), ms: since(t0), outbox: "mock" };
    },
  };
}

type Reply = Partial<Clearance> & {
  text?: string; transcript?: string; clearance?: Partial<Clearance> | null;
  severity?: string; reasoning?: string; outbox?: string;
};
const SEVERITIES = ["high", "medium", "low"] as const;
const OUTBOX: OutboxItem["status"][] = ["queued", "sent", "failed"];
const ACTIONS: Action[] = ["cleared_to_land", "cleared_for_takeoff", "line_up_and_wait", "cross_runway", "hold_short", "taxi", "stop", "readback", "clear_of_runway"];
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/** Only well-formed fields of a live parse, in the shapes the checker matches on; the regex parse fills the rest. */
function clean(j: Record<string, unknown>): Partial<Clearance> {
  const s = (v: unknown) => ((typeof v === "string" || typeof v === "number") && String(v).trim() ? String(v).trim() : undefined);
  const cs = s(j.callsign), rw = s(j.runway), tx = s(j.taxiway), conf = typeof j.confidence === "number" ? j.confidence : NaN;
  return {
    ...(ACTIONS.includes(j.action as Action) && { action: j.action as Action }),
    ...(cs && { callsign: normCallsign(cs) }),
    ...(rw && { runway: rw.toUpperCase().replace(/^(RUNWAY|RWY)|\s+/g, "") }),
    ...(tx && { taxiway: tx.toUpperCase().replace(/\s+/g, "") }),
    ...(Number.isFinite(conf) && { confidence: Math.min(1, Math.max(0, conf)) }),
  };
}

export function createHttpAgent({ baseUrl, sttPath = "/stt", parsePath = "/parse", conflictPath = "/conflict" }: {
  baseUrl: string; sttPath?: string; parsePath?: string; conflictPath?: string;
}): AgentPort {
  const mock = createMockAgent();
  let downUntil = 0;
  const post = async (path: string, body: BodyInit, ms: number, type = "application/json"): Promise<Reply> => {
    if (Date.now() < downUntil) throw new Error("agent cooling down");
    try {
      const res = await fetch(baseUrl.replace(/\/$/, "") + path, { method: "POST", headers: { "content-type": type }, body, signal: AbortSignal.timeout(ms) });
      if (!res.ok) throw new Error(`${path} ${res.status}`);
      const j = await res.json().catch(() => ({}));
      return j && typeof j === "object" ? j : {};
    } catch (err) { downUntil = Date.now() + COOLDOWN_MS; throw err; }
  };
  return {
    mode: "live",
    async transcribe(input) {
      const t0 = now();
      try {
        const j = input.audio
          ? await post(sttPath, input.audio, MS.stt, input.mime ?? "audio/webm")
          : await post(sttPath, JSON.stringify({ text: input.typed, audioUrl: input.audioUrl }), MS.stt);
        return { text: str(j.text) ?? str(j.transcript) ?? input.typed ?? "", ms: since(t0) };
      } catch { return mock.transcribe(input); }
    },
    async parse(text, ctx) {
      const t0 = now();
      try {
        const j = await post(parsePath, JSON.stringify({ text }), MS.parse);
        const got = clean((j.clearance && typeof j.clearance === "object" ? j.clearance : j) as Record<string, unknown>);
        const base = parseText(text, ctx); // fills whatever fields the live parser left out
        // shortcut: a live clearance with no confidence and no regex match gets 0 (amber), until Chris always sends one
        const clearance = got.action || base ? { speaker: ctx.speaker, callsign: "", confidence: 0, ...base, ...got, t: ctx.t } as Clearance : null;
        return { clearance, ms: since(t0) };
      } catch { return mock.parse(text, ctx); }
    },
    async judge(conflict, ctx) {
      const t0 = now();
      try {
        const j = await post(conflictPath, JSON.stringify({ conflict, alertId: ctx.alertId, text: ctx.text }), MS.judge);
        return {
          severity: SEVERITIES.find((s) => s === j.severity) ?? conflict.severity_hint,
          text: str(j.text),
          reasoning: str(j.reasoning) ?? reasoning(conflict),
          ms: since(t0),
          outbox: OUTBOX.find((s) => s === j.outbox) ?? "queued",
        };
      } catch { return mock.judge(conflict, ctx); }
    },
  };
}
