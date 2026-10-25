import { SCENARIO_LABEL, ZULU, type WorldState } from "@/lib/contract";
import { actions } from "@/lib/useWorld";
import { VIEW_BEARING } from "@/lib/sfo";
import { AudioControls } from "@/components/audio/AudioLayer";
import { Arrow, Chevron, Dot, Tri } from "./icons";

const LOCAL = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "short",
});

const PLANS = [
  { name: "West plan", arr: ["28L", "28R"], dep: ["1L", "1R"] },
  { name: "West, 28 departures", arr: ["28L", "28R"], dep: ["28L", "28R"] },
  { name: "Southeast plan", arr: ["19L", "19R"], dep: ["10L", "10R"] },
  { name: "Southeast, 10 arrivals", arr: ["10L", "10R"], dep: ["10L", "10R"] },
];

const FRACTION: Record<number, string> = { 0.25: "1/4", 0.5: "1/2", 0.75: "3/4" };
function vis(sm: number): string {
  const whole = Math.floor(sm), f = FRACTION[sm - whole];
  return f ? (whole ? `${whole} ${f}` : f) : `${+sm.toFixed(1)}`;
}

const Signs = ({ label, rwys }: { label: string; rwys: string[] }) => (
  <span className="flex items-center gap-1.5">
    <span className="mr-0.5 text-sm font-bold text-ink-2">{label}</span>
    {rwys.map((r) => <span key={r} className="sign-loc text-lg">{r}</span>)}
  </span>
);

export function Header({ world }: { world: WorldState }) {
  const { clock, config, weather: wx, weatherStatus: ws, ui } = world;
  const same = (a: string[], b: string[]) => a.join() === b.join();
  const hw = ws.headwindKt;
  return (
    <header className="flex h-[76px] gap-px overflow-hidden whitespace-nowrap [&>*]:bg-panel">
      <div className="flex flex-col justify-center gap-1 px-5">
        <span className="text-sm font-semibold text-ink-2">Ground Truth</span>
        <span className="sign-loc self-start text-lg">SFO TWR</span>
      </div>

      <div className="flex items-baseline gap-3 self-stretch px-5 pt-3.5">
        <span className="text-3xl font-bold">{ZULU(clock.simT)}</span>
        <span className="text-sm text-ink-2">{LOCAL.format(new Date(clock.simT))}</span>
      </div>

      <div className="flex items-center gap-4 px-5">
        <Signs label="ARR" rwys={config.arr} />
        <Signs label="DEP" rwys={config.dep} />
        <button
          popoverTarget="rwy-config"
          aria-label="Override runway configuration"
          style={{ anchorName: "--rwy-config" }}
          className="flex h-9 items-center gap-1.5 rounded border border-seam px-2.5 text-sm font-semibold text-ink-2 hover:border-ink-2"
        >
          {config.overridden ? "Overridden" : "Override"} <Chevron />
        </button>
        <div
          id="rwy-config"
          popover="auto"
          style={{ positionAnchor: "--rwy-config", inset: "auto", top: "anchor(bottom)", left: "anchor(left)", margin: "8px 0 0" }}
          className="flex-col gap-px border border-seam bg-seam p-0 text-ink [&:popover-open]:flex"
        >
          {PLANS.map((p) => {
            const on = same(p.arr, config.arr) && same(p.dep, config.dep);
            return (
              <button
                key={p.name}
                popoverTarget="rwy-config"
                popoverTargetAction="hide"
                aria-pressed={on}
                onClick={() => actions.command({ cmd: "config", arr: p.arr, dep: p.dep })}
                className="flex flex-col items-start gap-2 bg-panel px-4 py-3 text-left hover:bg-raised"
              >
                <span className="text-base font-semibold">{p.name}{on && <span className="ml-2 text-sm font-normal text-ink-2">in use</span>}</span>
                <span className="flex gap-4"><Signs label="ARR" rwys={p.arr} /><Signs label="DEP" rwys={p.dep} /></span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col justify-center gap-0.5 px-5" title={`Demo landing minimums: ceiling ${ws.minimums.ceiling_ft} ft, visibility ${vis(ws.minimums.visibility_sm)} SM`}>
        <span className="flex items-center gap-2 text-base font-semibold">
          {wx.wind_kt ? (
            <>
              <Arrow rotate={wx.wind_dir + 180 - VIEW_BEARING} title={`Wind from ${wx.wind_dir}°, drawn in the map's orientation`} />
              {String(wx.wind_dir).padStart(3, "0")}° {wx.wind_kt} kt
            </>
          ) : "Wind calm"}
          <span className="text-ink-2">·</span> {vis(wx.visibility_sm)} SM
          <span className="text-ink-2">·</span> {wx.ceiling_ft == null ? "no ceiling" : `ceiling ${wx.ceiling_ft.toLocaleString("en-US")} ft`}
        </span>
        <span className="flex items-center gap-3 text-sm text-ink-2">
          <span>{ws.runway} {hw >= 0 ? `head ${hw}` : `tail ${-hw}`} · cross {ws.crosswindKt} kt</span>
          {ws.belowMinimums
            ? <span className="flex items-center gap-1.5 font-bold text-caution"><Tri outline /> {ws.runway} below minimums</span>
            : <span>{ws.runway} above minimums</span>}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-4 px-5">
        {clock.scenario !== "normal" && <span className="truncate text-sm text-ink-2">{SCENARIO_LABEL[clock.scenario]} · simulated</span>}
        <AudioControls />
        <span className="flex items-center gap-2 rounded border-2 border-ink-2 px-2.5 py-1 text-sm font-bold tracking-wider">
          <Dot filled={ui.network === "online"} /> {ui.network === "online" ? "ONLINE" : "OFFLINE"}
        </span>
      </div>
    </header>
  );
}
