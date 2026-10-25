// Agent adapters: the scripted mock (offline default) and Chris's HTTP agent, which falls back to the mock on any failure.
import type { Clearance, Conflict, OutboxItem } from "@/lib/contract";
import type { AgentPort } from "./types";
import { parseText } from "./parser";

const TIMEOUT_MS = 8000;
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

export function createHttpAgent({ baseUrl, sttPath = "/stt", parsePath = "/parse", conflictPath = "/conflict" }: {
  baseUrl: string; sttPath?: string; parsePath?: string; conflictPath?: string;
}): AgentPort {
  const mock = createMockAgent();
  const post = async (path: string, body: BodyInit, type = "application/json"): Promise<Reply> => {
    const res = await fetch(baseUrl.replace(/\/$/, "") + path, { method: "POST", headers: { "content-type": type }, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    return res.json().catch(() => ({}));
  };
  return {
    mode: "live",
    async transcribe(input) {
      const t0 = now();
      try {
        const j = input.audio
          ? await post(sttPath, input.audio, input.mime ?? "audio/webm")
          : await post(sttPath, JSON.stringify({ text: input.typed, audioUrl: input.audioUrl }));
        return { text: j.text ?? j.transcript ?? input.typed ?? "", ms: since(t0) };
      } catch { return mock.transcribe(input); }
    },
    async parse(text, ctx) {
      const t0 = now();
      try {
        const j = await post(parsePath, JSON.stringify({ text }));
        const got = Object.fromEntries(Object.entries(j.clearance ?? j).filter(([, v]) => v != null)) as Partial<Clearance>;
        const base = parseText(text, ctx); // fills whatever fields the live parser left out
        // shortcut: a live clearance with no confidence and no regex match gets 0 (amber), until Chris always sends one
        const clearance = got.action || base ? { speaker: ctx.speaker, callsign: "", confidence: 0, ...base, ...got, t: ctx.t } as Clearance : null;
        return { clearance, ms: since(t0) };
      } catch { return mock.parse(text, ctx); }
    },
    async judge(conflict, ctx) {
      const t0 = now();
      try {
        const j = await post(conflictPath, JSON.stringify({ conflict, alertId: ctx.alertId, text: ctx.text }));
        return {
          severity: SEVERITIES.find((s) => s === j.severity) ?? conflict.severity_hint,
          text: j.text,
          reasoning: j.reasoning ?? reasoning(conflict),
          ms: since(t0),
          outbox: OUTBOX.find((s) => s === j.outbox) ?? "queued",
        };
      } catch { return mock.judge(conflict, ctx); }
    },
  };
}
