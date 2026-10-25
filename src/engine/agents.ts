// Agent adapters: the scripted mock (offline default) and Chris's HTTP agent, which falls back to the mock on any failure.
import type { Action, Clearance, Conflict, OutboxItem } from "@/lib/contract";
import type { AgentPort } from "./types";
import { normCallsign, parseText } from "./parser";

// Budgets sized so a hung agent still leaves time for the rule-1 alert; the judge runs after the alert is up.
const MS = { stt: 3000, parse: 3000, judge: 8000 }; // on the GB10 the gateway answers speech in ~0.5 s and parse in ~1.7 s
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

// Chris's gateway (agentic-workflow README): OpenAI-compatible at http://<gb10>:4000/v1, schemas from its config/.
const CLEARANCE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["speaker", "clearances", "flags"],
  properties: {
    speaker: { type: "string", enum: ["tower", "ground", "pilot", "vehicle", "unknown"] },
    clearances: {
      type: "array", maxItems: 4,
      items: {
        type: "object", additionalProperties: false, required: ["callsign", "action", "runway", "taxiway", "confidence"],
        properties: {
          callsign: { type: "string" },
          action: { type: "string", enum: ["cleared_to_land", "cleared_for_takeoff", "line_up_and_wait", "cross_runway", "hold_short", "taxi", "stop", "readback"] },
          runway: { type: "string" }, taxiway: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    flags: { type: "array", items: { type: "string", enum: ["correction", "low_confidence", "partial", "emergency_phrase", "non_clearance"] } },
  },
};
const SEVERITY_SCHEMA = {
  type: "object", additionalProperties: false, required: ["severity", "why", "confidence"],
  properties: { severity: { type: "string", enum: ["critical", "high", "non_critical", "uncertain"] }, why: { type: "string", maxLength: 300 }, confidence: { type: "number", minimum: 0, maximum: 1 } },
};
const GW_SEVERITY: Record<string, "high" | "medium" | "low"> = { critical: "high", high: "high", uncertain: "medium", non_critical: "low" };

/** Chris's gateway: ATC Whisper for speech, `fast` for the clearance JSON, `reason` for severity; mock on any failure. */
function createGatewayAgent(baseUrl: string, audioBase?: string): AgentPort {
  const mock = createMockAgent(), base = baseUrl.replace(/\/$/, "");
  const downUntil: Record<string, number> = {}; // per model, so a slow parser never silences the speech model
  const call = async (model: string, path: string, init: RequestInit, ms: number, priority: string): Promise<Record<string, unknown>> => {
    if (Date.now() < (downUntil[model] ?? 0)) throw new Error("agent cooling down");
    try {
      const res = await fetch(base + path, { method: "POST", ...init, headers: { "X-Priority": priority, ...init.headers }, signal: AbortSignal.timeout(ms) });
      if (!res.ok) throw new Error(`${path} ${res.status}`);
      const j = await res.json();
      return j && typeof j === "object" ? j : {};
    } catch (err) { downUntil[model] = Date.now() + COOLDOWN_MS; throw err; }
  };
  const chat = async (model: string, system: string, user: string, name: string, schema: object, ms: number, priority: string, headers: Record<string, string> = {}) => {
    const j = await call(model, "/chat/completions", {
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ model, temperature: 0, messages: [{ role: "system", content: system }, { role: "user", content: user }], response_format: { type: "json_schema", json_schema: { name, schema } } }),
    }, ms, priority);
    const content = (j.choices as { message?: { content?: string } }[] | undefined)?.[0]?.message?.content;
    return JSON.parse(content ?? "{}") as Record<string, unknown>;
  };
  return {
    mode: "live",
    async transcribe(input) {
      const t0 = now();
      try {
        const audio = input.audio ? new Blob([input.audio], { type: input.mime ?? "audio/webm" })
          : input.audioUrl && audioBase ? await (await fetch(audioBase + input.audioUrl, { signal: AbortSignal.timeout(MS.stt) })).blob() : null;
        if (!audio) return mock.transcribe(input); // a scripted call with no clip: its typed words stand in
        const form = new FormData();
        form.append("file", audio, input.audio ? "mic.webm" : "call.wav");
        form.append("model", "asr");
        const j = await call("asr", "/audio/transcriptions", { body: form }, MS.stt, "P1");
        return { text: str(j.text)?.trim() || input.typed || "", ms: since(t0) };
      } catch { return mock.transcribe(input); }
    },
    async parse(text, ctx) {
      const t0 = now();
      try {
        const j = await chat("fast", "Extract the air traffic control clearances in one radio transmission. Callsigns as spoken, e.g. 'BAYLINE 646', 'RESCUE 9'. Runways like '28L', taxiways like 'P'.", text, "ParsedRadioCall", CLEARANCE_SCHEMA, MS.parse, "P1");
        const first = (Array.isArray(j.clearances) ? j.clearances : [])[0] as Record<string, unknown> | undefined;
        const got = first ? clean(first) : {};
        const baseParse = parseText(text, ctx);
        const clearance = got.action || baseParse ? { speaker: ctx.speaker, callsign: "", confidence: 0, ...baseParse, ...got, t: ctx.t } as Clearance : null;
        return { clearance, ms: since(t0) };
      } catch { return mock.parse(text, ctx); }
    },
    async judge(conflict, ctx) {
      const t0 = now();
      try {
        const j = await chat("reason", "You rate a runway conflict that a deterministic rule already confirmed. You may raise severity, never dismiss it. Explain why in at most two sentences.", JSON.stringify({ conflict, alert: ctx.text }), "SeverityAssessment", SEVERITY_SCHEMA, MS.judge, "P2", { "X-Coalesce-Key": ctx.alertId });
        return { severity: GW_SEVERITY[str(j.severity) ?? ""] ?? conflict.severity_hint, reasoning: str(j.why) ?? reasoning(conflict), ms: since(t0), outbox: "mock" };
      } catch { return mock.judge(conflict, ctx); }
    },
  };
}

export function createHttpAgent({ baseUrl, sttPath = "/stt", parsePath = "/parse", conflictPath = "/conflict", audioBase }: {
  baseUrl: string; sttPath?: string; parsePath?: string; conflictPath?: string; audioBase?: string;
}): AgentPort {
  if (/\/v1\/?$/.test(baseUrl)) return createGatewayAgent(baseUrl, audioBase); // the README's base URL form
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
