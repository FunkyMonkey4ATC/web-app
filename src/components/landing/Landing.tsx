"use client";
// Splash: the LaGuardia reconstruction is the proof; the copy sits beside it.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LgaIncident } from "@/components/landing/LgaIncident";
import { actions } from "@/lib/useWorld";

const btn = "inline-flex min-h-12 items-center rounded px-5 font-semibold";

export default function Landing() {
  const router = useRouter();

  async function watch() {
    await actions.command({ cmd: "scenario", value: "incident" });
    router.push("/console");
  }

  return (
    <main className="relative isolate flex min-h-dvh flex-col overflow-hidden md:grid md:grid-rows-[auto_1fr_auto]">
      <header className="flex items-center gap-3 px-4 pt-6 text-sm sm:px-10 md:px-16">
        <span className="sign-loc">SFO Tower</span>
        <span className="font-semibold">Ground Truth</span>
      </header>
      <section className="flex max-w-3xl flex-col justify-center gap-6 px-4 py-10 sm:px-10 md:px-16">
        <h1 className="text-[clamp(2.5rem,7vw,5rem)] leading-[1.05] font-bold text-balance">
          A second set of ears for the tower.
        </h1>
        <p className="max-w-xl text-lg text-ink-2">
          Ground Truth listens to tower radio, matches each call to live aircraft, vehicle and weather data, and flags
          conflicts in about a second. It runs on one Dell Pro Max GB10, fully offline.
        </p>
        <p>Severe runway incursions rose 44% in 2025.</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/console" className={`${btn} bg-ink text-ground hover:bg-ink-2`}>Open the tower console</Link>
          <button type="button" onClick={watch} className={`${btn} border border-ink-2 hover:border-ink`}>Watch the incident</button>
        </div>
      </section>

      {/* phone: below the copy; md+: the right side of the page, behind nothing */}
      <div aria-hidden className="pointer-events-none relative h-[28rem] md:absolute md:inset-y-0 md:right-0 md:left-[max(36%,38rem)] md:-z-10 md:h-auto">
        <LgaIncident className="h-full w-full" />
      </div>

      <footer className="flex flex-wrap gap-x-5 gap-y-1 px-4 pb-6 text-sm text-ink-2 sm:px-10 md:px-16">
        <span>Runs on one Dell Pro Max GB10</span>
        <Link href="/operator" className="underline underline-offset-4">Operator</Link>
        <a href="https://github.com/FunkyMonkey4ATC/web-app" className="underline underline-offset-4" rel="noopener noreferrer">Repo</a>
      </footer>
    </main>
  );
}
