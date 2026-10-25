"use client";
// Splash: the looping incident replay is the background and the proof; the copy sits over it.
import Link from "next/link";
import { useRouter } from "next/navigation";
import AirfieldMap from "@/components/map/AirfieldMap";
import { actions, useLocalEngine } from "@/lib/useWorld";

const btn = "inline-flex min-h-12 items-center rounded px-5 font-semibold";

export default function Landing() {
  const world = useLocalEngine("incident", { loop: true });
  const router = useRouter();
  const alert = world?.alerts.find((a) => a.status === "active" && a.banner);

  async function watch() {
    await actions.command({ cmd: "scenario", value: "incident" });
    router.push("/console");
  }

  return (
    <main className="relative isolate grid min-h-dvh grid-rows-[1fr_auto] overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        {world && <AirfieldMap world={world} variant="hero" />}
        <div className="absolute inset-0 bg-ground/80 md:bg-transparent md:bg-linear-to-r md:from-ground md:from-35% md:via-ground/80 md:to-ground/0" />
      </div>

      <section className="flex max-w-3xl flex-col justify-center gap-6 px-4 py-10 sm:px-10 md:px-16">
        <p className="flex items-center gap-3">
          <span className="sign-loc text-sm">SFO TWR</span>
          <span className="font-semibold">Ground Truth</span>
        </p>
        <h1 className="text-[clamp(2.5rem,7vw,5rem)] leading-[1.05] font-bold text-balance">
          A second set of ears for the tower.
        </h1>
        <p className="max-w-xl text-lg text-ink-2">
          Ground Truth listens to tower radio, matches each call to live aircraft, vehicle and weather data, and flags
          conflicts in about a second. It runs on one Dell Pro Max GB10, fully offline.
        </p>
        <p>
          Severe runway incursions rose 44% in 2025.
          <span className="block text-sm text-ink-2">Source: AVweb, on an FAA Safety Team notice.</span>
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/console" className={`${btn} bg-ink text-ground hover:bg-ink-2`}>Open the tower console</Link>
          <button type="button" onClick={watch} className={`${btn} border border-ink-2 hover:border-ink`}>Watch the incident</button>
        </div>
      </section>

      <footer className="flex flex-col gap-4 px-4 pb-6 sm:px-10 md:flex-row md:items-end md:justify-between md:px-16">
        <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-2">
          <span>Runs on one Dell Pro Max GB10</span>
          <Link href="/operator" className="underline underline-offset-4">Operator</Link>
          <a href="https://github.com/FunkyMonkey4ATC/web-app" className="underline underline-offset-4" rel="noopener noreferrer">Repo</a>
        </p>
        <div className="flex max-w-md flex-col gap-3 md:items-end">
          {alert && (
            <div aria-hidden className="w-full border-l-[10px] border-warn bg-panel px-4 py-3">
              <p className="flex items-center gap-3 text-sm font-bold text-warn">
                <span className="sign-mand">{alert.zoneRunway ?? alert.conflict.runway}</span>▲ Warning
              </p>
              <p className="mt-2 text-lg font-semibold">{alert.text}</p>
              {alert.latencyMs !== null && (
                <p className="text-sm text-ink-2">alert {(alert.latencyMs / 1000).toFixed(1)} s after the call</p>
              )}
            </div>
          )}
          <p className="text-sm text-ink-2 md:text-right">
            Replay: the LaGuardia runway 4 sequence of March 22, 2026, restaged at SFO. Simulated.
          </p>
        </div>
      </footer>
    </main>
  );
}
