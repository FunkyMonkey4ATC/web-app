"use client";
// The demo runner's remote (phone or laptop). Every control is an OperatorCommand; every readout is world state.
import { useEffect, useState } from "react";
import { SCENARIO_LABEL, ZULU, type ScenarioId } from "@/lib/contract";
import { useWorld } from "@/lib/useWorld";

const SCENARIOS: { label: string; value: ScenarioId; ending?: "without" | "with" }[] = [
  { label: "Normal traffic", value: "normal" },
  { label: "Incident · without Ground Truth", value: "incident", ending: "without" },
  { label: "Incident · with Ground Truth", value: "incident", ending: "with" },
  { label: "Vehicle with no clearance", value: "no_clearance" },
  { label: "Visibility drop", value: "visibility" },
];
const SPEEDS = [1, 2, 4] as const;
const btn =
  "min-h-14 touch-manipulation rounded border border-ink-2 px-4 font-semibold " +
  "aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-ground " +
  "aria-checked:border-ink aria-checked:bg-ink aria-checked:text-ground " +
  "disabled:border-seam disabled:text-ink-3";
const pdt = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour12: false, timeZoneName: "short" });

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-panel p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-2">{title}</h2>
      {children}
    </section>
  );
}

export default function Operator() {
  const { world, mode, command } = useWorld();
  const [draft, setDraft] = useState<number | null>(null); // slider position until the world echoes it back
  const [confirmReset, setConfirmReset] = useState(false);
  const threshold = world?.ui.threshold;
  useEffect(() => {
    if (draft !== null && threshold !== undefined && Math.abs(draft - threshold) < 1e-3) setDraft(null);
  }, [draft, threshold]);

  if (!world) return <main className="mx-auto max-w-xl p-4 text-ink-2">Connecting to the console…</main>;

  const { clock, ui } = world;
  const ending = clock.ending ?? "with";
  const isActive = (s: (typeof SCENARIOS)[number]) => clock.scenario === s.value && (s.value !== "incident" || ending === s.ending);
  const label = clock.scenario === "incident" ? `${SCENARIO_LABEL.incident} · ${ending} Ground Truth` : SCENARIO_LABEL[clock.scenario];

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-px bg-seam">
      <section aria-label="Now" className="sticky top-0 z-10 bg-panel p-4">
        <div className="mb-2 flex items-center gap-3">
          <span className="sign-loc text-sm">SFO TWR</span>
          <span className="font-semibold">Ground Truth operator</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-3xl font-semibold">{ZULU(clock.simT)}</span>
          <span className="text-sm text-ink-2">{pdt(clock.simT)}</span>
        </div>
        <p className="text-lg">{label}</p>
        <p className="text-sm text-ink-2">
          {clock.playing ? "Playing" : "Paused"} · {clock.speed}x · {ui.agentMode === "live" ? "Live agent" : "Mock agent"} ·{" "}
          {ui.network === "online" ? "Online" : "Offline"}
        </p>
        {mode === "local" && (
          <p className="mt-2 text-sm text-ink-2">This device runs its own copy; it can&apos;t drive another screen on this host.</p>
        )}
      </section>

      <Section title="Scenario">
        <div className="grid gap-3">
          {SCENARIOS.map((s) => (
            <button key={s.label} aria-pressed={isActive(s)} className={`${btn} text-left`}
              onClick={() => command({ cmd: "scenario", value: s.value, ending: s.ending })}>
              {s.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Clock">
        <div className="grid grid-cols-2 gap-3">
          <button className={btn} onClick={() => command(clock.playing ? { cmd: "pause" } : { cmd: "play" })}>
            {clock.playing ? "Pause" : "Play"}
          </button>
          <button className={btn} onClick={() => command({ cmd: "restart" })}>Restart</button>
        </div>
        <div role="group" aria-label="Speed" className="mt-3 grid grid-cols-3 gap-3">
          {SPEEDS.map((s) => (
            <button key={s} aria-pressed={clock.speed === s} className={btn} onClick={() => command({ cmd: "speed", value: s })}>
              {s}x
            </button>
          ))}
        </div>
        <button className={`${btn} mt-3 w-full`} disabled={clock.scenario !== "incident"}
          onClick={() => command({ cmd: "jump", value: "before_crossing" })}>
          Jump to 10 s before the crossing
        </button>
        {clock.scenario !== "incident" && <p className="mt-1 text-sm text-ink-3">Incident scenarios only.</p>}
      </Section>

      <Section title="Demo screen">
        <button role="switch" aria-checked={ui.railOpen} className={`${btn} flex w-full items-center justify-between`}
          onClick={() => command({ cmd: "rail", value: !ui.railOpen })}>
          <span>Pipeline rail</span>
          <span>{ui.railOpen ? "Open" : "Closed"}</span>
        </button>
      </Section>

      <Section title="Confidence threshold">
        <label htmlFor="threshold" className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-ink-2">Calls below this show as low confidence and fire no rules.</span>
          <output htmlFor="threshold" className="text-xl font-semibold">{ui.threshold.toFixed(2)}</output>
        </label>
        <input id="threshold" type="range" min={0.5} max={0.95} step={0.05} value={draft ?? ui.threshold}
          className="h-12 w-full touch-manipulation accent-ink"
          onChange={(e) => {
            const v = Number(e.target.value);
            setDraft(v);
            command({ cmd: "threshold", value: v });
          }} />
        <div className="flex justify-between text-sm text-ink-3"><span>0.50</span><span>0.95</span></div>
      </Section>

      <Section title="Reset">
        {confirmReset ? (
          <div className="grid gap-3">
            <p>Reset everything {mode === "local" ? "on this device" : "on every screen"}? This can&apos;t be undone.</p>
            <div className="grid grid-cols-2 gap-3">
              <button className={btn} onClick={() => { command({ cmd: "reset" }); setConfirmReset(false); }}>Yes, reset all</button>
              <button className={btn} autoFocus onClick={() => setConfirmReset(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className={`${btn} w-full`} onClick={() => setConfirmReset(true)}>Reset all</button>
        )}
      </Section>
    </main>
  );
}
