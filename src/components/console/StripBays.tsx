import { useLayoutEffect, useRef } from "react";
import { BAY_LABEL, BAY_ORDER, ZULU, type Strip } from "@/lib/contract";
import { Tri } from "./icons";

const HATCH = "bg-[repeating-linear-gradient(45deg,var(--color-ink-2)_0_4px,transparent_4px_8px)]";

export function StripBays({ strips, selected, onSelect }: { strips: Strip[]; selected: string | null; onSelect: (id: string | null) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const prev = useRef(new Map<string, [number, number]>());

  // FLIP: offsetLeft/Top ignore transforms, so a strip caught mid-animation is measured at its layout slot.
  useLayoutEffect(() => {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, [number, number]>();
    for (const el of root.current!.querySelectorAll<HTMLElement>("[data-strip]")) {
      const id = el.dataset.strip!, p = prev.current.get(id), x = el.offsetLeft, y = el.offsetTop;
      next.set(id, [x, y]);
      if (p && !still && (p[0] !== x || p[1] !== y))
        el.animate([{ transform: `translate(${p[0] - x}px, ${p[1] - y}px)` }, { transform: "none" }], { duration: 200, easing: "ease-out" });
    }
    prev.current = next;
  });

  return (
    <div ref={root} className="relative flex h-full flex-col gap-px overflow-y-auto bg-seam">
      {BAY_ORDER.map((bay) => {
        const list = strips.filter((s) => s.bay === bay).sort((a, b) => (b.lastCallT ?? "").localeCompare(a.lastCallT ?? ""));
        return (
          <section key={bay} className="bg-panel px-3 pb-2.5 last:flex-1">
            <h2 className="flex h-10 items-center justify-between text-lg font-semibold text-ink-2">
              {BAY_LABEL[bay]} <span className="text-base">{list.length}</span>
            </h2>
            <div className="flex flex-col gap-1.5">
              {list.map((s) => (
                <StripCard key={s.trackId} s={s} on={selected === s.trackId} onClick={() => onSelect(selected === s.trackId ? null : s.trackId)} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function StripCard({ s, on, onClick }: { s: Strip; on: boolean; onClick: () => void }) {
  const veh = s.kind === "vehicle";
  const border = s.state === "warning" ? "border-2 border-warn" : s.state === "caution" ? "border-2 border-caution" : "border border-seam";
  const band = s.state === "warning" ? "bg-warn" : s.state === "caution" ? "bg-caution" : veh ? HATCH : "bg-runway";
  const side = s.radioOnly ? `RADIO ONLY${s.estimated ? " · EST" : ""}`
    : s.estimated ? "EST"
    : s.gate ? `Gate ${s.gate}`
    : [s.distanceNm != null && `${s.distanceNm.toFixed(1)} NM`, s.speedKt != null && `${Math.round(s.speedKt)} kt`].filter(Boolean).join(" · ");
  return (
    <button
      data-strip={s.trackId}
      onClick={onClick}
      aria-pressed={on}
      className={`grid min-h-[78px] w-full grid-cols-[8px_1fr_auto] overflow-hidden bg-raised text-left ${veh ? "rounded-none" : "rounded"} ${border} ${s.source === "simulated" ? "border-dashed" : ""} ${on ? "outline-3 outline-offset-2 outline-clear" : ""}`}
    >
      <span className={band} />
      <span className="flex min-w-0 flex-col justify-between gap-1 px-3.5 py-2">
        <span className="flex items-center gap-2.5">
          {veh && <span className="border-2 border-ink px-1 text-sm font-bold leading-tight tracking-wider">VEH</span>}
          <span className="text-xl font-bold leading-none">{s.callsign}</span>
          {s.type && !veh && <span className="text-sm text-ink-2">{s.type}</span>}
          {s.source === "simulated" && <span className="rounded-sm border border-dashed border-ink-2 px-1.5 text-sm font-bold tracking-wider text-ink-2">SIM</span>}
        </span>
        <span className="truncate text-base text-ink-2">
          {s.clearance ? <span className="font-semibold text-clear">{s.clearance}</span> : s.source === "recorded" ? "" : "No clearance heard"}
          {s.clearanceT && ` ${ZULU(s.clearanceT)}`}
        </span>
      </span>
      <span className="flex flex-col items-end justify-between gap-1 px-3.5 py-2 text-right">
        <span className="flex gap-1.5 text-sm font-bold tracking-wider">
          {s.state === "warning" && <span className="flex items-center gap-1 rounded-sm bg-warn px-1.5 text-ground"><Tri /> CONFLICT</span>}
          {s.state === "caution" && <span className="flex items-center gap-1 rounded-sm border border-caution px-1.5 text-caution"><Tri outline /> CAUTION</span>}
          {s.confidence != null && <span className="rounded-sm border border-caution px-1.5 text-caution">? {s.confidence.toFixed(2)}</span>}
        </span>
        <span className="text-base text-ink-2">{side}</span>
      </span>
    </button>
  );
}
