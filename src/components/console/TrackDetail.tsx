import { useEffect, useRef } from "react";
import { BAY_LABEL, ZULU, spoken, type WorldState } from "@/lib/contract";
import { spoken as callName } from "@/engine/airfield";
import { Arrow, Tri } from "./icons";

const TAG = "rounded-sm px-1.5 text-sm font-bold tracking-wider";

const X = () => (
  <svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true">
    <path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
  </svg>
);

/** Pop-up facts for one track. Closes on the X, Escape, or any click outside it. */
export function TrackDetail({ world, trackId, onClose }: { world: WorldState; trackId: string; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => back?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  const t = world.tracks.find((x) => x.id === trackId);
  const s = world.strips.find((x) => x.trackId === trackId);
  const cs = t?.callsign;
  const veh = t?.kind === "vehicle";
  const calls = world.calls.filter((c) => c.from === cs || c.to === cs || c.linkedTrackId === trackId).slice(0, 4);
  // The "without" ending replays the night with no Ground Truth, so no alert may show here either.
  const without = world.clock.scenario === "incident" && world.clock.ending === "without";
  const alerts = without ? [] : world.alerts.filter((a) => a.partyTrackIds.includes(trackId));
  const origin = !t ? [] : [
    t.source === "simulated" ? ["SIM", "Simulated traffic"] : t.source === "live" ? ["LIVE", "Live ADS-B position, a few seconds old"] : !t.estimated && ["RECORDED", "Recorded SFO position"],
    t.estimated && ["EST", "Position estimated from radio, no GPS"],
  ].filter((x): x is string[] => !!x);
  const facts: [string, string][] = !t ? [] : [
    ["Speed", `${Math.round(t.speed_kt)} kt`],
    ["Heading", `${String(Math.round(t.heading) % 360).padStart(3, "0")}°`],
    ...(t.alt_ft ? [["Altitude", `${Math.round(t.alt_ft).toLocaleString("en-US")} ft`] as [string, string]] : []),
    ...(s?.distanceNm != null ? [["To threshold", `${s.distanceNm.toFixed(1)} NM`] as [string, string]] : []),
  ];

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-label={cs ? `${cs} details` : "Track details"}
        tabIndex={-1}
        className="fixed left-1/2 top-24 z-40 flex max-h-[calc(100dvh-108px)] w-[min(400px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-y-auto border border-seam bg-raised text-ink lg:left-auto lg:right-[calc(35%+12px)] lg:translate-x-0"
      >
        <header className="flex items-start gap-3 p-4">
          <div className="min-w-0">
            {t ? (
              <>
                <p className="flex items-center gap-2.5">
                  {veh && <span className="border-2 border-current px-1 text-sm font-bold leading-tight tracking-wider">VEH</span>}
                  <span className="text-xl font-bold leading-none">{cs}</span>
                </p>
                {callName(cs!) !== cs && <p className="mt-1.5 text-base text-ink-2">{callName(cs!)}</p>}
                <p className="mt-1 text-sm text-ink-2">{[!veh && (t.type ?? s?.type), veh ? "Vehicle" : "Aircraft"].filter(Boolean).join(" · ")}</p>
              </>
            ) : (
              <p className="text-lg font-semibold text-ink-2">No longer tracked</p>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="ml-auto grid size-10 shrink-0 place-items-center rounded border border-ink-2 text-lg hover:border-ink">
            <X />
          </button>
        </header>

        {t && (
          <>
            <section className="flex flex-col gap-1.5 border-t border-seam p-4">
              {origin.map(([tag, line]) => (
                <p key={tag} className="flex items-center gap-2.5 text-sm text-ink-2">
                  <span className={`${TAG} border ${tag === "RECORDED" || tag === "LIVE" ? "border-ink-2" : "border-dashed border-ink-2"}`}>{tag}</span>
                  {line}
                </p>
              ))}
            </section>

            <section className="border-t border-seam p-4">
              {s && (
                <p className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-base">
                  <span className="font-semibold">{BAY_LABEL[s.bay]}</span>
                  {s.clearance && <span className="font-semibold text-clear">{s.clearance}</span>}
                  {s.clearanceT && <span className="text-sm text-ink-2">{ZULU(s.clearanceT)}</span>}
                  {s.confidence != null && <span className={`${TAG} border border-caution text-caution`}>? {s.confidence.toFixed(2)}</span>}
                </p>
              )}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                {facts.map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-sm text-ink-2">{k}</dt>
                    <dd className="text-base font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="border-t border-seam p-4">
              <h3 className="mb-2 text-base font-semibold text-ink-2">Radio</h3>
              {calls.length ? (
                <ol className="flex flex-col gap-3">
                  {calls.map((c) => (
                    <li key={c.id}>
                      <p className="flex items-center gap-1.5 text-sm">
                        <span className="text-ink-2">{ZULU(c.t)}</span>
                        <span className="ml-1 flex items-center gap-1.5 font-semibold text-clear">{spoken(c.from)}<Arrow rotate={90} />{spoken(c.to)}</span>
                      </p>
                      <p className="text-base">“{c.transcript}”</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-ink-2">No radio calls heard for this {veh ? "vehicle" : "aircraft"}</p>
              )}
            </section>

            {alerts.length > 0 && (
              <section className="border-t border-seam p-4">
                <h3 className="mb-2 text-base font-semibold text-ink-2">Alerts</h3>
                <ul className="flex flex-col gap-3">
                  {alerts.map((a) => {
                    // Red and orange only while the alert still needs action; resolved ones go quiet.
                    const live = a.status === "active";
                    const color = !live ? "text-ink-2" : a.level === "warning" ? "text-warn" : "text-caution";
                    return (
                      <li key={a.id}>
                        <p className="flex items-center gap-2 text-sm">
                          <span className={`flex items-center gap-1 font-bold tracking-wider ${color}`}><Tri outline={a.level === "caution"} /> {a.level.toUpperCase()}</span>
                          <span className="text-ink-2">
                            {ZULU(a.t)} · {live ? "Active" : "Resolved"}
                            {a.response && ` · ${a.response === "ack" ? "Acknowledged" : "False alarm"}`}
                          </span>
                        </p>
                        <p className="text-base">{a.text}</p>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}
