"use client";
import { useEffect, useRef, useState } from "react";
import { ZULU, spoken } from "@/lib/contract";
import { useWorld } from "@/lib/useWorld";
import { AirfieldMap } from "@/components/map/AirfieldMap";
import { Rail } from "@/components/rail/Rail";
import { AudioLayer } from "@/components/audio/AudioLayer";
import { Header } from "@/components/console/Header";
import { AlertDock } from "@/components/console/AlertDock";
import { StripBays } from "@/components/console/StripBays";
import { Arrow } from "@/components/console/icons";

const R1 = "crossing_on_landing_runway";

export default function ConsolePage() {
  const { world, command, feedback } = useWorld();
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState<"field" | "corridor">("field");
  const [rail, setRail] = useState(false);
  const [black, setBlack] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);
  const fireCountdown = useRef(new Map<string, number>());
  const prevT = useRef("");

  const serverRail = world?.ui.railOpen ?? false;
  useEffect(() => setRail(serverRail), [serverRail]);
  const toggleRail = (v: boolean) => { setRail(v); command({ cmd: "rail", value: v }); };

  const without = world?.clock.scenario === "incident" && world.clock.ending === "without";
  // "without" replays the night with no Ground Truth: never show a banner, whatever the engine emits.
  const banners = !world || without ? [] : world.alerts.filter((a) => a.status === "active" && a.banner).sort((a, b) => b.t.localeCompare(a.t));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const newest = banners.find((a) => !a.response);
      const k = e.key.toLowerCase();
      if (e.code === "Backquote") toggleRail(!rail);
      else if (k === "escape") setSelected(null);
      else if (k === "z") setZoom((z) => (z === "field" ? "corridor" : "field"));
      else if (k === "a" && newest) feedback(newest.id, "ack");
      else if (k === "f" && newest) feedback(newest.id, "false_alarm");
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  // Incident endings: latch the fade to black ("without"), and the closing line once the rule-1 alert resolves ("with").
  useEffect(() => {
    if (!world) return;
    const { scenario, ending, simT } = world.clock;
    const rewound = simT < prevT.current;
    prevT.current = simT;
    const r1 = world.alerts.filter((a) => a.conflict.rule === R1);
    const live = r1.find((a) => a.status === "active" && a.countdown);
    if (scenario !== "incident" || ending !== "without" || rewound) setBlack(false);
    else if (live && live.countdown!.seconds <= 3) setBlack(true);
    for (const a of r1) {
      // countdown at fire time = live countdown + sim time elapsed since the alert fired
      if (a.status === "active" && a.countdown && !fireCountdown.current.has(a.id))
        fireCountdown.current.set(a.id, a.countdown.seconds + (Date.parse(simT) - Date.parse(a.t)) / 1000);
      const s = fireCountdown.current.get(a.id);
      if (a.status !== "resolved" || s === undefined) continue;
      fireCountdown.current.delete(a.id);
      if (scenario === "incident" && ending === "with") {
        setClosing(`Ground Truth alerted ${Math.round(s)} s before Bayline 646 reached taxiway P.`);
        setTimeout(() => setClosing(null), 10_000);
      }
    }
  }, [world]);

  if (!world) return <main className="grid h-dvh place-items-center text-lg text-ink-2">Connecting to the tower feed…</main>;

  const c = world.caption;
  return (
    <main className="grid h-dvh grid-cols-1 grid-rows-[auto_1fr] gap-px overflow-hidden bg-seam">
      <Header world={world} />
      <div className="grid min-h-0 grid-cols-[65fr_35fr] gap-px">
        <div className="grid min-h-0 grid-rows-[1fr_auto] gap-px">
          <section aria-label="Airfield, tower view" className="relative min-h-0 overflow-hidden bg-ground">
            <div className="absolute inset-0">
              <AirfieldMap world={world} selectedTrackId={selected} zoom={zoom} onSelect={setSelected} />
            </div>
            <div className="absolute inset-x-0 top-0 z-10">
              <AlertDock alerts={banners} />
              {closing && <p className="border-b border-seam bg-panel px-6 py-2.5 text-lg font-semibold">{closing}</p>}
            </div>
          </section>
          <footer className="flex h-16 items-center gap-5 bg-panel px-6">
            {c ? (
              <>
                <span className="flex items-center gap-1.5 font-semibold text-clear">{spoken(c.from)}<Arrow rotate={90} />{spoken(c.to)}</span>
                <span className="truncate text-xl font-medium">“{c.text}”</span>
                <span className="ml-auto text-sm text-ink-2">{ZULU(c.t)}</span>
              </>
            ) : (
              <span className="text-ink-3">Listening to tower and ground</span>
            )}
          </footer>
        </div>
        <div className="relative min-h-0 overflow-hidden bg-panel">
          <StripBays strips={world.strips} selected={selected} onSelect={setSelected} />
          <Rail world={world} open={rail} onClose={() => toggleRail(false)} />
        </div>
      </div>
      <div
        aria-hidden={!black}
        className={`fixed inset-0 z-50 grid place-items-center bg-black px-8 transition-opacity duration-1000 ${black ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <p className="max-w-3xl text-center text-2xl font-semibold text-white">LaGuardia, March 22, 2026, 23:37 EDT. Two pilots died.</p>
      </div>
      <AudioLayer world={world} />
    </main>
  );
}
