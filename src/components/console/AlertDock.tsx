import { ZULU, type Alert } from "@/lib/contract";
import { actions, useWorld } from "@/lib/useWorld";
import { Tri } from "./icons";

const Kbd = ({ k }: { k: string }) => <kbd className="rounded-sm border border-current px-1.5 text-sm font-bold opacity-75">{k}</kbd>;

/** Active warning banners, newest first (cautions stay on strips and the rail). Overlays the top of the map; never resizes it. */
export function AlertDock({ alerts }: { alerts: Alert[] }) {
  const mock = useWorld().world?.ui.agentMode === "mock"; // shared store; the console page already subscribes
  if (!alerts.length) return null;
  return (
    <div className="flex flex-col gap-px bg-seam">
      {alerts.slice(0, 3).map((a) => (a.response === "ack" ? <Acked key={a.id} a={a} mock={mock} /> : <Banner key={a.id} a={a} mock={mock} />))}
      {alerts.length > 3 && <p className="bg-panel px-6 py-1.5 text-sm font-semibold text-ink-2">+{alerts.length - 3} more</p>}
    </div>
  );
}

const latency = (a: Alert, mock: boolean) => (a.latencyMs == null ? "" : `alert ${(a.latencyMs / 1000).toFixed(1)} s after the call${mock ? " · mock agent" : ""}`);

/** Acknowledged: one slim line until the conflict resolves. */
function Acked({ a, mock }: { a: Alert; mock: boolean }) {
  return (
    <section role="status" className="flex items-center gap-3 bg-panel px-6 py-1.5 text-sm text-ink-2">
      <span className="sign-mand shrink-0">{a.zoneRunway ?? a.conflict.runway}</span>
      <span className="truncate text-base font-semibold text-ink">{a.text}</span>
      <span className="ml-auto shrink-0 font-semibold text-ink">Acknowledged</span>
      <span className="shrink-0">{latency(a, mock)}</span>
    </section>
  );
}

function Banner({ a, mock }: { a: Alert; mock: boolean }) {
  return (
    <section role="alert" className="bg-[color-mix(in_srgb,var(--color-warn)_12%,var(--color-panel))]">
      <div className="px-6 py-3">
        <div className="flex items-center gap-3 text-sm">
          <span className="sign-mand text-lg">{a.zoneRunway ?? a.conflict.runway}</span>
          <span className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-warn"><Tri /> Warning</span>
          <span className="truncate text-ink-2">{a.detail}</span>
        </div>
        <p className="my-2 text-2xl font-semibold leading-tight">{a.text}</p>
        <div className="flex items-center gap-4 text-sm text-ink-2">
          <button onClick={() => actions.feedback(a.id, "ack")} className="flex h-10 shrink-0 items-center gap-3 rounded bg-ink px-3.5 text-base font-semibold text-ground">
            Acknowledge <Kbd k="A" />
          </button>
          {a.countdown && <span className="text-base font-bold text-ink">{a.countdown.label}</span>}
          <span>{[latency(a, mock), ZULU(a.t)].filter(Boolean).join(" · ")}</span>
          <button onClick={() => actions.feedback(a.id, "false_alarm")} className="ml-auto flex h-10 shrink-0 items-center gap-3 rounded border border-ink-2 px-3.5 text-base font-semibold text-ink">
            False alarm <Kbd k="F" />
          </button>
        </div>
      </div>
    </section>
  );
}
