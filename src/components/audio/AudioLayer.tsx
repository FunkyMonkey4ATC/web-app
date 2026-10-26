"use client";
// Radio playback, the warning chime and the mic (toggled from its chip). Mute and mic state are shared by AudioLayer and AudioControls.
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { Call, WorldState } from "@/lib/contract";
import { actions } from "@/lib/useWorld";
import { newVad, vadStep } from "./vad";
import { toWav16k } from "./wav";

type Mic = "off" | "listening" | "speech";
const INITIAL = { muted: false, mic: "off" as Mic };
let store = INITIAL;
const listeners = new Set<() => void>();
const set = (s: Partial<typeof store>) => { store = { ...store, ...s }; listeners.forEach((l) => l()); };
const useAudio = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => store, () => INITIAL);

let ctx: AudioContext | null = null;
let clip: { el: HTMLAudioElement; call: Call } | null = null;
let quietUntil = 0;
let starting = false;
let stopMic: (() => void) | null = null;
// Our own speaker output must not come back in through the mic as a second copy of the call.
const busy = () => performance.now() < quietUntil || (clip !== null && !clip.el.paused && !clip.el.muted);

async function enableMic() {
  if (starting || store.mic !== "off") return;
  starting = true;
  ctx ??= new AudioContext(); // created inside the gesture so the chime can play even if the mic is refused
  void ctx.resume();
  try {
    listen(ctx, await navigator.mediaDevices.getUserMedia({ audio: true }));
  } catch (e) {
    console.warn("Mic unavailable (needs permission, and localhost or HTTPS)", e);
  }
  starting = false;
}

function listen(ac: AudioContext, stream: MediaStream) {
  const an = ac.createAnalyser();
  an.fftSize = 1024;
  const src = ac.createMediaStreamSource(stream);
  src.connect(an);
  const buf = new Float32Array(an.fftSize), vad = newVad();
  let stop: ((send: boolean) => void) | null = null;

  const start = () => {
    const chunks: Blob[] = [], rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
    let send = false;
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => { if (send) void toWav16k(new Blob(chunks, { type: "audio/webm" })).then(actions.mic, (e) => console.warn("Mic audio not decodable", e)); };
    rec.start();
    stop = (s) => { send = s; rec.stop(); stop = null; set({ mic: "listening" }); };
  };

  const timer = setInterval(() => {
    if (busy()) { stop?.(false); vad.phase = "idle"; return; }
    an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const x of buf) sum += x * x;
    const ev = vadStep(vad, Math.sqrt(sum / buf.length), performance.now());
    if (ev === "start") start();
    else if (ev === "confirm") set({ mic: "speech" });
    else if (ev) stop?.(ev === "finish");
  }, 30);
  const off = () => { clearInterval(timer); stop?.(false); src.disconnect(); stream.getTracks().forEach((t) => t.stop()); stopMic = null; set({ mic: "off" }); };
  stopMic = off;
  stream.getAudioTracks()[0].onended = off; // mic unplugged
  set({ mic: "listening" });
}

function chime() {
  if (!ctx || store.muted) return;
  const ac = ctx, t = ac.currentTime;
  [988, 740].forEach((hz, i) => {
    const o = ac.createOscillator(), g = ac.createGain(), s = t + i * 0.2;
    o.frequency.value = hz;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(0.35, s + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, s + 0.18);
    o.connect(g).connect(ac.destination);
    o.start(s);
    o.stop(s + 0.2);
  });
  quietUntil = performance.now() + 700;
}

function play(call: Call) {
  clip?.el.pause();
  const el = new Audio(call.audio);
  el.onended = el.onerror = () => { if (clip?.el === el) clip = null; };
  clip = { el, call };
}

// Keeps the clip on the replay clock: paused with it, at its speed, snapped back after a jump or a slow load.
function sync(clock: WorldState["clock"], muted: boolean) {
  if (!clip) return;
  const { el, call } = clip, at = (Date.parse(clock.simT) - Date.parse(call.t)) / 1000;
  el.muted = muted;
  el.playbackRate = clock.speed;
  if (!clock.playing || at < 0) return el.pause();
  if (Math.abs(el.currentTime - at) > clock.speed) el.currentTime = at;
  if (el.paused) el.play().catch(() => {}); // blocked until the first gesture; the next tick retries
}

/** Plays radio clips and the warning chime. Renders nothing. */
export function AudioLayer({ world }: { world: WorldState | null }) {
  const { muted } = useAudio();
  const prev = useRef<{ calls: Set<string>; warns: Set<string> } | null>(null);

  useEffect(() => {
    // the chime needs an AudioContext made inside a gesture; the mic itself starts only from its chip
    const onGesture = () => { ctx ??= new AudioContext(); void ctx.resume(); };
    addEventListener("pointerdown", onGesture, { once: true });
    addEventListener("keydown", onGesture, { once: true });
    return () => {
      removeEventListener("pointerdown", onGesture);
      removeEventListener("keydown", onGesture);
      clip?.el.pause();
      clip = null;
    };
  }, []);

  useEffect(() => {
    if (!world) return;
    const p = prev.current;
    const calls = new Set(world.calls.map((c) => c.id));
    const warns = new Set(world.alerts.filter((a) => a.status === "active" && a.level === "warning" && a.banner).map((a) => a.id));
    prev.current = { calls, warns };
    // Diff against the previous world, so nothing already on screen at load replays, and a restarted scenario plays again.
    if (p) {
      if ([...warns].some((id) => !p.warns.has(id))) chime();
      const fresh = world.calls.find((c) => !p.calls.has(c.id) && c.audio && c.source !== "mic");
      if (fresh) play(fresh);
    }
    sync(world.clock, muted);
  }, [world, muted]);

  return null;
}

const CHIP = "flex h-9 items-center gap-2 rounded border px-3 text-sm font-bold";
const MIC_LABEL: Record<Mic, string> = { off: "Mic off", listening: "Listening", speech: "Hearing speech" };

/** Header controls: mute toggle and the mic status chip. */
export function AudioControls() {
  const { muted, mic } = useAudio();
  const micInner = (
    <>
      <MicIcon state={mic} />
      {/* reserves the widest label so the header never shifts */}
      <span className="grid">
        <span aria-hidden className="invisible col-start-1 row-start-1">{MIC_LABEL.speech}</span>
        <span className="col-start-1 row-start-1">{MIC_LABEL[mic]}</span>
      </span>
    </>
  );
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => set({ muted: !muted })} title="Radio audio and the warning chime" className={`${CHIP} border-ink-2 hover:bg-raised`}>
        <SpeakerIcon muted={muted} />
        {muted ? "Muted" : "Sound on"}
      </button>
      {mic === "off" ? (
        <button type="button" onClick={() => void enableMic()} title="Turn on the microphone" className={`${CHIP} border-dashed border-ink-2 text-ink-2 hover:bg-raised`}>
          {micInner}
        </button>
      ) : (
        <button type="button" onClick={() => stopMic?.()} title="Turn off the microphone" className={`${CHIP} hover:bg-raised ${mic === "speech" ? "border-clear text-clear" : "border-ink-2 text-ink-2"}`}>
          {micInner}
        </button>
      )}
    </div>
  );
}

const Icon = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

const SpeakerIcon = ({ muted }: { muted: boolean }) => (
  <Icon>
    <path d="M4 9h3l5-4v14l-5-4H4z" />
    {muted ? <path d="M16 9l5 6M21 9l-5 6" /> : <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />}
  </Icon>
);

const MicIcon = ({ state }: { state: Mic }) => (
  <Icon>
    <rect x="9" y="3" width="6" height="11" rx="3" fill={state === "speech" ? "currentColor" : "none"} />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
    {state === "off" && <path d="M4 4l16 16" />}
  </Icon>
);
