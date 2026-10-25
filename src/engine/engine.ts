// Engine orchestrator: owns WorldState and drives clock -> sim -> pipeline -> checker -> agent. Isomorphic.
import type { Alert, Call, OutboxItem, ScenarioId, Stage, WorldState } from "@/lib/contract";
import type { ActiveClearances, AgentPort, CreateEngine, RawCall } from "@/engine/types";
import { createSim } from "@/engine/sim";
import { createAirfield } from "@/engine/airfield";
import { runCall } from "@/engine/pipeline";

const TICK_MS = 250;
const MAX_CALLS = 40;
const iso = (ms: number) => new Date(ms).toISOString();
const at = Date.parse;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), n = s.length;
  return Math.round((s[(n - 1) >> 1] + s[n >> 1]) / 2);
}

export const createEngine: CreateEngine = ({ agent, network }) => {
  const sim = createSim(), airfield = createAirfield();
  const subs = new Set<(w: WorldState) => void>();
  const inFlight = new Set<Promise<Call>>();
  const endReal = new Map<string, number>(); // call id -> real ms the call ended; alert latency counts from here
  const open = new Map<string, Alert>();     // detection key -> its active alert
  const latencies: number[] = [];
  let active: ActiveClearances = {}, pending: RawCall[] = [];
  let simMs = 0, prevMs = 0, lastReal = Date.now(), ticks = 0, epoch = 0, seq = 0, holdEval = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let world = blank(), snap = world;

  function blank(): WorldState {
    return {
      clock: { speed: 1 }, outbox: [],
      stats: { calls: 0, clearances: 0, lowConfidence: 0, alerts: 0, falseAlarms: 0, medianLatencyMs: null },
      ui: { railOpen: false, threshold: 0.75, agentMode: agent.mode, network, micListening: false },
    } as unknown as WorldState; // load() fills the rest
  }
  // a fresh deep copy per change so React (useSyncExternalStore) sees every update
  const emit = () => { snap = structuredClone(world); subs.forEach((f) => f(snap)); };
  const strips = () => { world.strips = airfield.deriveStrips(world, active); };

  function frame() {
    const f = sim.frame(world.clock.simT);
    world.tracks = f.tracks;
    world.weather = f.weather;
    world.weatherStatus = airfield.weatherStatus(f.weather, world.config);
  }

  function load(scenario: ScenarioId, ending?: "with" | "without") {
    epoch++; // late pipeline results from the previous run are dropped
    active = {}; pending = []; open.clear(); endReal.clear(); holdEval = false;
    ending = scenario === "incident" ? ending ?? "with" : undefined;
    sim.load(scenario, ending);
    simMs = at(sim.startT());
    prevMs = simMs - 1; // callsBetween is (from, to]: keep a call that starts exactly at startT
    world = {
      ...world,
      clock: { ...world.clock, simT: sim.startT(), playing: true, scenario, ending },
      config: { ...sim.config(), overridden: false },
      calls: [], alerts: [], caption: null,
    };
    frame();
    strips();
  }

  function tick() {
    const real = Date.now(), { playing, speed } = world.clock, endMs = at(sim.endT());
    if (playing) simMs = Math.min(simMs + (real - lastReal) * speed, endMs);
    if (simMs >= endMs) world.clock.playing = false;
    world.clock.simT = iso(simMs);
    frame();
    for (const raw of sim.callsBetween(iso(prevMs), world.clock.simT)) {
      world.caption = { callId: raw.id, freq: raw.freq, from: raw.from, to: raw.to, text: raw.text, t: raw.t };
      pending.push(raw);
    }
    prevMs = simMs;
    // the pipeline starts when the call ends: speech-to-text needs the whole clip, and latency counts from the end
    const due = pending.filter((r) => at(r.endT) <= simMs);
    pending = pending.filter((r) => at(r.endT) > simMs);
    for (const raw of due) {
      endReal.set(raw.id, Math.max(lastReal, real - (simMs - at(raw.endT)) / speed));
      void run(raw);
    }
    lastReal = real;
    if (++ticks % (1000 / TICK_MS) === 0) evaluate();
    strips();
    emit();
  }

  function put(c: Call) {
    const i = world.calls.findIndex((x) => x.id === c.id);
    if (i >= 0) world.calls[i] = c;
    else { world.calls.unshift(c); world.calls.splice(MAX_CALLS); world.stats.calls++; }
  }

  async function run(raw: RawCall, mic?: { audio: ArrayBuffer; mime: string }) {
    const e = epoch;
    const update = (c: Call) => {
      if (e !== epoch) return;
      if (mic) c = { ...c, source: "mic" }; // RawCall.source has no "mic"
      put(c);
      if (c.transcript && (mic || world.caption?.callId === c.id))
        world.caption = { callId: c.id, freq: c.freq, from: c.from, to: c.to, text: c.transcript, t: c.t };
      emit();
    };
    const port: AgentPort = mic ? {
      mode: agent.mode,
      transcribe: (i) => agent.transcribe({ ...i, ...mic }),
      parse: (text, ctx) => agent.parse(text, ctx),
      judge: (c, ctx) => agent.judge(c, ctx),
    } : agent;
    const p = runCall(raw, { agent: port, tracks: world.tracks, threshold: world.ui.threshold, onUpdate: update });
    inFlight.add(p);
    let call: Call;
    try { call = await p; } catch (err) { console.error("pipeline failed", raw.id, err); return; } finally { inFlight.delete(p); }
    if (e !== epoch) return;
    if (mic) call = { ...call, source: "mic" };
    if (call.lowConfidence) {
      world.stats.lowConfidence++;
      call = { ...call, verdict: "caution" };
    } else if (call.clearance) {
      const t0 = Date.now();
      airfield.applyClearance(active, call.clearance, call.id);
      const rules: Call["rules"] = airfield.checkCall(call, world, active);
      world.stats.clearances++;
      // "caution" until evaluate() raises an alert on this call and sets its level
      call = { ...call, rules, verdict: rules.every((r) => r.pass) ? "ok" : "caution", stages: { ...call.stages, check: { ms: Date.now() - t0, ok: true } } };
    }
    put(call);
    evaluate(); // right away, not at the next 1 s check, so the alert follows the call
    strips();
    emit();
  }

  function evaluate() {
    if (holdEval && inFlight.size) return; // after a jump, let the replayed calls set their clearances first
    holdEval = false;
    const real = Date.now(), seen = new Set<string>();
    const hide = world.clock.scenario === "incident" && world.clock.ending === "without";
    for (const d of airfield.evaluate(world, active)) {
      seen.add(d.key);
      const live = {
        level: d.level, detail: d.detail, partyTrackIds: d.partyTrackIds, zoneRunway: d.zoneRunway,
        paths: d.paths, point: d.point, countdown: d.countdown, banner: d.banner && !hide,
      };
      const known = open.get(d.key);
      if (known) { Object.assign(known, live); continue; }
      const end = d.triggerCallId ? endReal.get(d.triggerCallId) : undefined;
      const alert: Alert = {
        id: `A${++seq}`, t: world.clock.simT, conflict: d.conflict, text: d.text, callId: d.triggerCallId,
        latencyMs: end === undefined ? null : Math.round(real - end), status: "active", ...live,
      };
      open.set(d.key, alert);
      world.alerts.unshift(alert);
      world.stats.alerts++;
      if (alert.latencyMs !== null) latencies.push(alert.latencyMs);
      const call = world.calls.find((c) => c.id === d.triggerCallId);
      if (call) Object.assign(call, { alertId: alert.id, verdict: alert.level });
      void judge(alert);
    }
    for (const [key, a] of open) if (!seen.has(key)) { a.status = "resolved"; open.delete(key); }
    const all = world.alerts;
    world.alerts = [...all.filter((a) => a.status === "active"), ...all.filter((a) => a.status === "resolved").slice(0, 10)];
    world.stats.medianLatencyMs = median(latencies);
  }

  function toOutbox(alertId: string, text: string, status: OutboxItem["status"]) {
    const o = world.outbox.find((x) => x.alertId === alertId);
    if (o) Object.assign(o, { text, status });
    else { world.outbox.unshift({ alertId, t: world.clock.simT, text, status }); world.outbox.splice(MAX_CALLS); }
  }

  async function judge(alert: Alert) {
    const t0 = Date.now();
    const evidence = world.calls.filter((c) => c.id === alert.callId || alert.conflict.evidence.includes(c.id));
    let stage: Stage, status: OutboxItem["status"];
    try {
      const r = await agent.judge(alert.conflict, { alertId: alert.id, text: alert.text, evidence });
      Object.assign(alert, { severity: r.severity, reasoning: r.reasoning }, r.text ? { text: r.text } : {});
      stage = { ms: r.ms, ok: true };
      status = r.outbox;
    } catch (err) {
      stage = { ms: Date.now() - t0, ok: false, note: String(err) };
      status = "failed";
    }
    const call = world.calls.find((c) => c.id === alert.callId);
    if (call) call.stages = { ...call.stages, judge: stage };
    toOutbox(alert.id, alert.text, status);
    emit();
  }

  load("normal");
  emit();

  return {
    getWorld: () => snap,
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    command(c) {
      const { scenario, ending } = world.clock;
      switch (c.cmd) {
        case "play": if (simMs >= at(sim.endT())) load(scenario, ending); world.clock.playing = true; break;
        case "pause": world.clock.playing = false; break;
        case "speed": world.clock.speed = c.value; break;
        case "scenario": load(c.value, c.ending); break;
        case "restart": load(scenario, ending); break;
        case "reset": world = blank(); latencies.length = 0; load("normal"); break;
        case "jump": {
          const t = sim.jumpTarget(c.value);
          if (!t) break;
          load(scenario, ending); // the next tick replays every call before t, so standing clearances are right
          simMs = at(t);
          world.clock.simT = t;
          holdEval = true;
          frame();
          strips();
          break;
        }
        case "rail": world.ui.railOpen = c.value; break;
        case "threshold": world.ui.threshold = c.value; break;
        case "config": world.config = { arr: c.arr, dep: c.dep, overridden: true }; frame(); strips(); break;
      }
      emit();
    },
    feedback(alertId, response) {
      const a = world.alerts.find((x) => x.id === alertId);
      if (!a || a.response === response) return;
      world.stats.falseAlarms += response === "false_alarm" ? 1 : a.response === "false_alarm" ? -1 : 0;
      a.response = response;
      emit();
    },
    agentAlert(a) {
      const alert = world.alerts.find((x) => x.id === a.alertId);
      if (!alert) return;
      Object.assign(alert, { severity: a.severity, text: a.text }, a.reasoning ? { reasoning: a.reasoning } : {});
      if (a.outbox) toOutbox(alert.id, a.text, a.outbox);
      emit();
    },
    async micUtterance(audio, mime) {
      world.ui.micListening = true;
      const t = world.clock.simT, id = `MIC${++seq}`;
      endReal.set(id, Date.now());
      await run({ id, t, endT: t, freq: "TWR", speaker: "tower", from: "TWR", to: "", text: "", source: "scenario" }, { audio, mime });
    },
    start() {
      if (timer) return;
      lastReal = Date.now();
      timer = setInterval(tick, TICK_MS);
    },
    stop() { clearInterval(timer); timer = undefined; },
  };
};
