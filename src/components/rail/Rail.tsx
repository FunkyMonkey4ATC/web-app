"use client";
// Demo-only pipeline rail: every call from audio to verdict. Overlays the strip column; the parent must be `relative overflow-hidden`.
import { useEffect, useId, useState, type ReactNode } from "react";
import { ZULU, spoken, type Alert, type Call, type OutboxItem, type RuleId, type Stage, type WorldState } from "@/lib/contract";
import { Dot, Tri } from "@/components/console/icons";
import { jsonTokens, secs, waveform, type Tok } from "./format";

const RULES: Record<RuleId, [number, string]> = {
  crossing_on_landing_runway: [1, "Crossing or takeoff on a landing runway"],
  runway_incursion_no_clearance: [2, "On a runway without clearance"],
  weather_below_minimums: [3, "Weather below landing minimums"],
  readback_mismatch: [4, "Readback matches the instruction"],
};
const SOURCE: Record<Call["source"], string> = { replay: "replay", mic: "live mic", scenario: "scenario" };
const OUTBOX: Record<OutboxItem["status"], ReactNode> = {
  queued: <><Dot filled={false} /> queued</>, sent: <><Mark pass cls="" /> sent</>, failed: <><Mark pass={false} cls="" /> failed</>, mock: <><Dot filled /> mock</>,
};
const TOK: Record<Tok["k"], string> = { key: "text-ink-2", str: "text-ink", num: "text-ink", lit: "text-ink font-bold", punc: "text-ink-3" };
const CAPS = "[font-variant-caps:all-small-caps] tracking-wider font-bold text-ink-2";
const KBD = "rounded-sm border border-current px-1.5 text-sm font-bold opacity-75";

const stageMs = (s?: Stage) => (s ? `${Math.round(s.ms)} ms` : undefined);
const actionText = (c: Call) => (c.clearance ? [c.clearance.action.replaceAll("_", " "), c.clearance.runway].filter(Boolean).join(" ") : "");
const liveWarning = (a?: Alert) => a?.status === "active" && a.level === "warning";

export function Rail({ world, open, onClose }: { world: WorldState; open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"calls" | "outbox">("calls");
  const [raw, setRaw] = useState(false);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const s = world.stats;
  const stats: [string, string | number][] = [
    ["Calls", s.calls], ["Clearances", s.clearances], ["Low confidence", s.lowConfidence],
    ["Alerts", s.alerts], ["False alarms", s.falseAlarms], ["Median latency", s.medianLatencyMs == null ? "—" : secs(s.medianLatencyMs)],
  ];
  const tabs = [["calls", "Calls", world.calls.length], ["outbox", "Outbox", world.outbox.length]] as const;

  return (
    <section
      aria-labelledby={`${id}-h`}
      inert={!open}
      className={`@container absolute inset-0 z-20 flex flex-col border-l border-seam bg-panel transition-transform duration-200 ease-out motion-reduce:transition-none ${open ? "translate-x-0" : "translate-x-full"}`}
    >
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-seam px-4">
        <h2 id={`${id}-h`} className="text-lg font-bold">Pipeline</h2>
        <span className="rounded-[2px] border border-ink-2 px-1.5 text-xs font-bold tracking-wider text-ink-2">DEMO{world.ui.agentMode === "mock" && " · mock agent"}</span>
        <button onClick={onClose} className="ml-auto flex h-9 items-center gap-2 rounded border border-ink-2 px-3 text-sm font-bold hover:bg-raised">
          Close <kbd className={KBD}>Esc</kbd>
        </button>
      </header>

      <dl className="grid shrink-0 grid-cols-3 gap-px @xl:grid-cols-6 border-b border-seam bg-seam">
        {stats.map(([label, value]) => (
          <div key={label} className="flex flex-col bg-panel px-3 py-2">
            <dt className="order-last text-xs leading-tight text-ink-2">{label}</dt>
            <dd className="text-xl font-bold">{value}</dd>
          </div>
        ))}
      </dl>

      <div role="tablist" aria-label="Rail views" className="flex shrink-0 border-b border-seam px-2">
        {tabs.map(([k, label, n]) => (
          <button
            key={k} role="tab" id={`${id}-${k}`} aria-selected={tab === k} aria-controls={`${id}-panel`} onClick={() => setTab(k)}
            className={`-mb-px h-11 border-b-[3px] px-3 font-bold ${tab === k ? "border-ink text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
          >
            {label} <span className="font-normal text-ink-2">{n}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} className="min-h-0 flex-1 overflow-y-auto">
        {tab === "outbox" ? <Outbox items={world.outbox} /> : !world.calls.length ? (
          <p className="p-4 text-ink-2">No calls heard yet.</p>
        ) : (
          <ol>
            {world.calls.map((c, i) => {
              const isOpen = toggled[c.id] ?? i === 0;
              return (
                <CallCard
                  key={c.id} call={c} world={world} open={isOpen} raw={raw} setRaw={setRaw}
                  onToggle={() => setToggled((t) => ({ ...t, [c.id]: !isOpen }))}
                />
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

function CallCard({ call, world, open, onToggle, raw, setRaw }: {
  call: Call; world: WorldState; open: boolean; onToggle: () => void; raw: boolean; setRaw: (v: boolean) => void;
}) {
  const alert = call.alertId ? world.alerts.find((a) => a.id === call.alertId) : undefined;
  const live = liveWarning(alert);
  const v = call.verdict;
  const vCls = v === "caution" ? "text-caution" : v === "warning" && live ? "text-warn" : v ? "text-ink" : "text-ink-3";
  const vShort = v === "ok" ? "No conflict" : v === "caution" ? "Caution" : v === "warning" ? "Warning" : "Checking…";
  const vIcon = v === "ok" ? <Mark pass cls="" /> : v === "caution" ? <Tri outline /> : v === "warning" ? <Tri /> : null;
  const latency = alert?.latencyMs != null ? ` · alert in ${secs(alert.latencyMs)}` : "";
  const track = call.linkedTrackId ? world.tracks.find((t) => t.id === call.linkedTrackId) : undefined;
  const c = call.clearance;

  return (
    <li className={`border-b border-seam ${open ? "bg-raised" : ""}`}>
      <h3 className="text-base font-normal">
        <button aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-raised">
          <span className="shrink-0 text-ink-2">{ZULU(call.t)}</span>
          <span className="shrink-0 font-bold">{spoken(call.from)} → {spoken(call.to)}</span>
          <span title={actionText(call)} className="truncate text-ink-2">{actionText(call)}</span>
          <span className={`ml-auto flex shrink-0 items-center gap-1.5 font-bold ${vCls}`}>{vIcon}{vShort}</span>
          <svg aria-hidden viewBox="0 0 12 12" className={`size-3 shrink-0 text-ink-2 ${open ? "rotate-180" : ""}`}>
            <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
      </h3>

      {open && (
        <div className="px-4 pb-3">
          <Row label="Audio" ms={secs(Date.parse(call.endT) - Date.parse(call.t))}>
            <div className="flex items-center gap-3">
              {call.audio && (
                <button
                  onClick={() => { new Audio(call.audio).play().catch(() => {}); }}
                  aria-label="Play call audio" className="flex size-9 shrink-0 items-center justify-center rounded border border-ink-2 hover:bg-panel"
                >
                  <svg aria-hidden viewBox="0 0 12 12" className="size-3"><path d="M3 1.5v9l7-4.5z" fill="currentColor" /></svg>
                </button>
              )}
              <Wave id={call.id} />
              <span className="shrink-0 text-sm text-ink-2">{SOURCE[call.source]}</span>
            </div>
          </Row>

          <Row label="Transcript" ms={stageMs(call.stages.stt)}>
            {call.transcript ? <q className="text-xl font-bold leading-snug">{call.transcript}</q> : <Waiting />}
          </Row>

          <Row label="Clearance" ms={stageMs(call.stages.parse)}>
            {c ? (
              <>
                <div role="group" aria-label="Clearance view" className="mb-2 flex gap-1">
                  {([["Fields", false], ["JSON", true]] as const).map(([label, isRaw]) => (
                    <button
                      key={label} aria-pressed={raw === isRaw} onClick={() => setRaw(isRaw)}
                      className={`h-8 rounded border px-2.5 text-sm font-bold ${raw === isRaw ? "border-ink text-ink" : "border-seam text-ink-2 hover:text-ink"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {raw ? (
                  <pre className="overflow-x-auto whitespace-pre rounded border border-seam bg-ground p-3 font-mono text-sm leading-snug">
                    {jsonTokens(c).map((t, i) => <span key={i} className={TOK[t.k]}>{t.s}</span>)}
                  </pre>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    <Chip k="callsign">{c.callsign}</Chip>
                    <Chip k="action">{c.action.replaceAll("_", " ")}</Chip>
                    {c.runway && <Chip k="runway"><span className="sign-loc">{c.runway}</span></Chip>}
                    {c.taxiway && <Chip k="taxiway"><span className="sign-loc">{c.taxiway}</span></Chip>}
                    <Chip k="confidence" caution={call.lowConfidence}>{call.lowConfidence ? "? " : ""}{c.confidence.toFixed(2)}</Chip>
                  </ul>
                )}
              </>
            ) : call.stages.parse ? <span className="text-ink-2">No clearance in this call</span> : <Waiting />}
          </Row>

          <Row label="Linked track" ms={stageMs(call.stages.link)}>
            {call.linkedTrackId ? (
              <div>
                <span className="font-bold">{track?.callsign ?? call.linkedTrackId}</span>{" "}
                {track && (
                  <span className="text-ink-2">
                    {[track.type, track.kind === "vehicle" && "vehicle", track.source === "simulated" && "SIM", track.estimated && "EST"].filter(Boolean).join(" · ")}
                  </span>
                )}
              </div>
            ) : !call.linkNote && (call.stages.link ? <span className="text-ink-2">No track linked</span> : <Waiting />)}
            {call.linkNote && <div className={call.linkedTrackId ? "text-sm text-ink-2" : ""}>{call.linkNote}</div>}
          </Row>

          <Row label="Rules" ms={stageMs(call.stages.check)}>
            {call.lowConfidence && (
              <p className="font-bold text-caution">? below {world.ui.threshold.toFixed(2)} · rules not applied</p>
            )}
            {call.rules.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {[...call.rules].sort((a, b) => RULES[a.rule][0] - RULES[b.rule][0]).map((r) => {
                  const failCls = live && alert?.conflict.rule === r.rule ? "text-warn"
                    : r.rule === "weather_below_minimums" || r.rule === "readback_mismatch" ? "text-caution" : "text-ink";
                  return (
                    <li key={r.rule} className="flex gap-2">
                      <Mark pass={r.pass} label={r.pass ? "pass" : "fail"} cls={`mt-1 ${r.pass ? "text-ink-2" : failCls}`} />
                      <div className="min-w-0">
                        <span className="font-bold">Rule {RULES[r.rule][0]}</span> <span className="text-ink-2">{RULES[r.rule][1]}</span>
                        <div className={`text-sm ${r.pass ? "text-ink-2" : failCls}`}>{r.why}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : !call.lowConfidence && <Waiting />}
          </Row>

          <Row label="Judge" ms={stageMs(call.stages.judge)}>
            {!call.alertId ? <span className="text-ink-3">Not called</span>
              : !alert ? <span className="text-ink-2">Alert no longer in history</span>
              : alert.reasoning ? (
                <>
                  <p>{alert.reasoning}</p>
                  {alert.severity && <p className="mt-1 text-sm text-ink-2">Severity {alert.severity}</p>}
                </>
              ) : <Waiting />}
          </Row>

          <Row label="Verdict">
            <p className={`flex flex-wrap items-center gap-2 font-bold ${vCls}`}>
              {v === "warning" && live && alert && <span className="sign-mand text-sm">{alert.conflict.runway}</span>}
              {!(v === "warning" && live) && vIcon}
              {v === "caution" ? `Caution${latency}` : v === "warning" ? `Warning${latency}${alert?.status === "resolved" ? " · resolved" : ""}` : vShort}
            </p>
            {alert && <p className="mt-1">{alert.text}</p>}
          </Row>
        </div>
      )}
    </li>
  );
}

function Row({ label, ms, children }: { label: string; ms?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_1fr_4rem] gap-3 border-t border-seam py-2.5 first:border-t-0">
      <h4 className={`pt-0.5 text-sm ${CAPS}`}>{label}</h4>
      <div className="min-w-0">{children}</div>
      <span className="pt-0.5 text-right text-sm text-ink-3">{ms}</span>
    </div>
  );
}

function Chip({ k, caution, children }: { k: string; caution?: boolean; children: ReactNode }) {
  return (
    <li className={`flex items-center gap-2 rounded border bg-panel px-2 py-1 ${caution ? "border-caution" : "border-seam"}`}>
      <span className="text-xs text-ink-2">{k}</span>
      <span className={`font-bold ${caution ? "text-caution" : ""}`}>{children}</span>
    </li>
  );
}

function Mark({ pass, cls, label }: { pass: boolean; cls: string; label?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`size-4 shrink-0 ${cls}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={pass ? "M2.5 8.5l3.5 3.5 7.5-8" : "M3 3l10 10M13 3L3 13"} fill="none" stroke="currentColor" strokeWidth="2.5" />
    </svg>
  );
}

function Wave({ id }: { id: string }) {
  const bars = waveform(id);
  return (
    <svg aria-hidden viewBox={`0 0 ${bars.length * 4} 32`} preserveAspectRatio="none" className="h-8 min-w-0 flex-1 text-ink-2">
      {bars.map((b, i) => <rect key={i} x={i * 4} y={16 - b * 15} width="2.5" height={b * 30} fill="currentColor" />)}
    </svg>
  );
}

const Waiting = () => <span className="text-ink-3">waiting…</span>;

function Outbox({ items }: { items: OutboxItem[] }) {
  if (!items.length) return <p className="p-4 text-ink-2">No alerts in the outbox yet.</p>;
  return (
    <ol>
      {[...items].sort((a, b) => b.t.localeCompare(a.t)).map((o) => (
        <li key={`${o.alertId}-${o.t}`} className="border-b border-seam px-4 py-3">
          <div className="mb-1 flex items-center gap-3 text-sm text-ink-2">
            <span>{ZULU(o.t)}</span>
            <span className="ml-auto flex items-center gap-1 rounded-[2px] border border-ink-2 px-1.5 font-bold">{OUTBOX[o.status]}</span>
          </div>
          <p className="whitespace-pre-wrap">{o.text}</p>
        </li>
      ))}
    </ol>
  );
}
