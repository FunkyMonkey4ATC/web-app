import { ZULU, type Alert } from "@/lib/contract";
import { actions } from "@/lib/useWorld";
import { Tri } from "./icons";

const Kbd = ({ k }: { k: string }) => <kbd className="rounded-sm border border-current px-1.5 text-sm font-bold opacity-75">{k}</kbd>;

/** Active banner alerts, newest first. Overlays the top of the map; never resizes it. */
export function AlertDock({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) return null;
  return (
    <div className="flex flex-col gap-px bg-seam">
      {alerts.slice(0, 3).map((a) => <Banner key={a.id} a={a} />)}
      {alerts.length > 3 && <p className="bg-panel px-6 py-1.5 text-sm font-semibold text-ink-2">+{alerts.length - 3} more</p>}
    </div>
  );
}

function Banner({ a }: { a: Alert }) {
  const warn = a.level === "warning";
  return (
    <section
      role={warn ? "alert" : "status"}
      className={warn
        ? "grid grid-cols-[10px_1fr] bg-[color-mix(in_srgb,var(--color-warn)_12%,var(--color-panel))]"
        : "border-2 border-caution bg-panel"}
    >
      {warn && <div className="bg-warn" />}
      <div className="px-6 py-3">
        <div className="flex items-center gap-3 text-sm">
          <span className={`${warn ? "sign-mand" : "sign-loc"} text-lg`}>{a.zoneRunway ?? a.conflict.runway}</span>
          <span className={`flex items-center gap-1.5 font-bold uppercase tracking-wider ${warn ? "text-warn" : "text-caution"}`}>
            <Tri outline={!warn} /> {warn ? "Warning" : "Caution"}
          </span>
          <span className="truncate text-ink-2">{a.detail}</span>
        </div>
        <p className={`my-2 font-semibold leading-tight ${warn ? "text-2xl" : "text-xl"}`}>{a.text}</p>
        <div className="flex items-center gap-4 text-sm text-ink-2">
          {a.response ? (
            <span className="font-semibold text-ink">{a.response === "ack" ? "Acknowledged" : "Marked as false alarm"}</span>
          ) : (
            <button onClick={() => actions.feedback(a.id, "ack")} className="flex h-10 items-center gap-3 rounded bg-ink px-3.5 text-base font-semibold text-ground">
              Acknowledge <Kbd k="A" />
            </button>
          )}
          {a.countdown && <span className="text-base font-bold text-ink">{a.countdown.label}</span>}
          <span>{a.latencyMs != null && `alert ${(a.latencyMs / 1000).toFixed(1)} s after the call · `}{ZULU(a.t)}</span>
          {!a.response && (
            <button onClick={() => actions.feedback(a.id, "false_alarm")} className="ml-auto flex h-10 items-center gap-3 rounded border border-ink-2 px-3.5 text-base font-semibold text-ink">
              False alarm <Kbd k="F" />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
