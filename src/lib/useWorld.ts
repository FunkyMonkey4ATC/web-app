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
    mode = "server";
    world = msg.world;
    emit();
  };
  ws.onclose = async () => {
    clearTimeout(fallback);
    if (mode === "server") { started = false; mode = "connecting"; setTimeout(connect, 1000); return; } // server restarted: reconnect
    mode = "local";
    engine = await startLocal();
    world = engine.getWorld();
    engine.subscribe((w) => { world = w; emit(); });
    emit();
  };
}

const post = (path: string, body: unknown) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});

export const actions = {
  command: (c: OperatorCommand) => (engine ? engine.command(c) : post("/api/operator", c)),
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
export function useLocalEngine(scenario: ScenarioId, opts: { loop?: boolean } = {}): WorldState | null {
  const [w, setW] = useState<WorldState | null>(null);
  useEffect(() => {
    let e: Engine | null = null, alive = true;
    startLocal(scenario).then((eng) => {
      if (!alive) return eng.stop();
      e = eng;
      eng.subscribe((next) => {
        setW(next);
        if (opts.loop && !next.clock.playing) eng.command({ cmd: "restart" });
      });
    });
    return () => { alive = false; e?.stop(); };
  }, [scenario, opts.loop]);
  return w;
}
