"use client";
// Radio log: every call heard this session (the world keeps only the last 40), opened from the caption bar.
import { useEffect, useRef, useState } from "react";
import { ZULU, spoken, type Call, type WorldState } from "@/lib/contract";
import { Arrow, Chevron } from "./icons";

const MAX = 500; // shortcut: session-only log in this tab, capped; a durable incident store is a later decision

export function CaptionHistory({ world }: { world: WorldState }) {
  const [open, setOpen] = useState(false);
  const log = useRef(new Map<string, Call>());
  const box = useRef<HTMLDivElement>(null);

  // calls update stage by stage, so keep the latest copy of each id
  for (const c of world.calls) if (c.transcript) log.current.set(c.id, c);
  if (log.current.size > MAX) log.current = new Map([...log.current].sort((a, b) => b[1].t.localeCompare(a[1].t)).slice(0, MAX));
  const rows = [...log.current.values()].sort((a, b) => b.t.localeCompare(a.t));

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", down);
    return () => { window.removeEventListener("keydown", key, true); window.removeEventListener("pointerdown", down); };
  }, [open]);

  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" aria-expanded={open} aria-controls="radio-log" onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded border border-seam px-3 py-1.5 text-sm font-semibold text-ink-2 hover:border-ink-2 hover:text-ink">
        Log <span className="text-ink-3">{rows.length}</span>
        <span className={open ? "" : "rotate-180"}><Chevron /></span>
      </button>
      {open && (
        <section id="radio-log" role="dialog" aria-label="Radio log"
          className="absolute right-0 bottom-full z-20 mb-3 flex max-h-[55vh] w-[min(46rem,60vw)] flex-col border border-seam bg-raised">
          <header className="flex items-center justify-between border-b border-seam px-4 py-2.5">
            <h2 className="font-semibold">Radio log <span className="text-sm font-normal text-ink-2">· {rows.length} calls this session</span></h2>
            <button type="button" onClick={() => setOpen(false)} className="rounded px-2 py-1 text-sm text-ink-2 hover:text-ink">Close <kbd className="ml-1 rounded border border-current px-1 text-xs">Esc</kbd></button>
          </header>
          {rows.length === 0 ? (
            <p className="px-4 py-6 text-ink-2">No radio calls heard yet.</p>
          ) : (
            <ol className="overflow-y-auto">
              {rows.map((c) => (
                <li key={c.id} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 border-b border-seam px-4 py-2.5 last:border-b-0">
                  <span className="pt-0.5 text-sm text-ink-2">{ZULU(c.t)}</span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-clear">
                      {spoken(c.from)}<Arrow rotate={90} />{spoken(c.to) || "—"}
                      {c.source === "mic" && <span className="rounded-sm border border-ink-2 px-1 text-xs text-ink-2">MIC</span>}
                      {c.lowConfidence && <span className="rounded-sm border border-caution px-1 text-xs text-caution">? {c.clearance?.confidence.toFixed(2)}</span>}
                      {c.verdict === "warning" && <span className="text-xs text-warn">Warning</span>}
                    </p>
                    <p className="text-base leading-snug break-words">“{c.transcript}”</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}
