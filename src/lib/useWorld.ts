"use client";
// The one way UI reads the world. Server mode (GB10): WebSocket to the custom server, shared by every screen.
// Local mode (Vercel or no server): the same engine runs in this tab with the mock agent.
import { useEffect, useState, useSyncExternalStore } from "react";
import type { OperatorCommand, ScenarioId, ServerMessage, WorldState } from "./contract";
import type { Engine } from "@/engine/types";

type Mode = "connecting" | "server" | "local";
let world: WorldState | null = null;
let mode: Mode = "connecting";
let engine: Engine | null = null;
let started = false;
let served = false; // once a server has answered, this tab never falls back to its own engine
let retryMs = 1000;
let pendingScenario: ScenarioId | undefined; // a scenario picked before the local engine exists (landing page, no server)
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

async function startLocal(scenario?: ScenarioId): Promise<Engine> {
  const [{ createEngine }, { createMockAgent }] = await Promise.all([import("@/engine/engine"), import("@/engine/agents")]);
  const e = createEngine({ agent: createMockAgent(), network: navigator.onLine ? "online" : "offline" });
  if (scenario) e.command({ cmd: "scenario", value: scenario });
  e.start();
  return e;
}

function connect() {
  if (started || typeof window === "undefined") return;
  started = true;
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  const fallback = setTimeout(() => ws.close(), 1500);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data) as ServerMessage;
    if (msg.type !== "world") return;
    clearTimeout(fallback);
    served = true; retryMs = 1000;
    mode = "server";
    world = msg.world;
    emit();
  };
  ws.onclose = async () => {
    clearTimeout(fallback);
    if (served) { // server restarted: keep reconnecting, backing off to 8 s
      started = false; mode = "connecting";
      setTimeout(connect, retryMs); retryMs = Math.min(retryMs * 2, 8000);
      return;
    }
    mode = "local";
    engine = await startLocal(pendingScenario);
    world = engine.getWorld();
    engine.subscribe((w) => { world = w; emit(); });
    emit();
  };
}

const post = (path: string, body: unknown) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});

export const actions = {
  command: (c: OperatorCommand) => {
    if (engine) return engine.command(c);
    if (c.cmd === "scenario") pendingScenario = c.value;
    return post("/api/operator", c);
  },
  feedback: (alertId: string, response: "ack" | "false_alarm") => (engine ? engine.feedback(alertId, response) : post("/api/feedback", { alertId, response })),
  mic: async (audio: Blob) => {
    if (engine) return engine.micUtterance(await audio.arrayBuffer(), audio.type);
    await fetch("/api/mic", { method: "POST", headers: { "content-type": audio.type }, body: audio }).catch(() => {});
  },
};

/** Shared live world (server or local fallback). */
export function useWorld(): { world: WorldState | null; mode: Mode } & typeof actions {
  const w = useSyncExternalStore(
    (l) => { listeners.add(l); connect(); return () => listeners.delete(l); },
    () => world,
    () => null,
  );
  return { world: w, mode, ...actions };
}

/** A private engine for one component (the landing page's looping incident replay). Never touches the shared world. */
export function useLocalEngine(scenario: ScenarioId, opts: { loop?: boolean; jump?: "before_crossing" } = {}): WorldState | null {
  const [w, setW] = useState<WorldState | null>(null);
  useEffect(() => {
    let e: Engine | null = null, alive = true;
    startLocal(scenario).then((eng) => {
      if (!alive) return eng.stop();
      e = eng;
      // a jump reloads the scenario itself, so it doubles as the loop restart
      let from = Infinity;
      const begin = () => {
        from = Infinity; // the command emits synchronously; don't re-trigger from inside it
        eng.command(opts.jump ? { cmd: "jump", value: opts.jump } : { cmd: "restart" });
        from = Date.parse(eng.getWorld().clock.simT);
      };
      eng.subscribe((next) => {
        setW(next);
        // from the jump, 40 s covers the call, the alert and its resolution; the rest of the scenario is a quiet rollout
        if (opts.loop && (!next.clock.playing || (opts.jump && Date.parse(next.clock.simT) - from > 40_000))) begin();
      });
      if (opts.jump) begin();
    });
    return () => { alive = false; e?.stop(); };
  }, [scenario, opts.loop, opts.jump]);
  return w;
}
