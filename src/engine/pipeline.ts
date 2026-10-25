// One radio call through stt -> parse -> link. The engine runs check and judge after this.
import type { Call } from "@/lib/contract";
import type { RunCall } from "./types";

const since = (t0: number) => Math.round(performance.now() - t0);

export const runCall: RunCall = async (raw, { agent, tracks, threshold, onUpdate }) => {
  const call: Call = {
    id: raw.id, t: raw.t, endT: raw.endT, freq: raw.freq, speaker: raw.speaker, from: raw.from, to: raw.to,
    transcript: "", audio: raw.audio, source: raw.source, stages: {}, lowConfidence: false, rules: [],
  };
  const emit = () => onUpdate({ ...call, stages: { ...call.stages } }); // fresh object so React sees each stage
  const controller = raw.speaker === "tower" || raw.speaker === "ground";

  let t0 = performance.now();
  const heard = await agent.transcribe({ callId: raw.id, typed: raw.text, audioUrl: raw.audio });
  call.transcript = heard.text || raw.text; // fallback to the typed transcript stays silent on screen
  call.stages.stt = { ms: since(t0), ok: !!call.transcript };
  emit();

  t0 = performance.now();
  const { clearance } = await agent.parse(call.transcript, { callId: raw.id, t: raw.t, freq: raw.freq, speaker: raw.speaker, scripted: raw.scripted });
  if (clearance) {
    call.clearance = { ...clearance, callsign: clearance.callsign || (controller ? raw.to : raw.from), ...(raw.audio && { audio: raw.audio }) };
    call.lowConfidence = clearance.confidence < threshold;
  }
  call.stages.parse = {
    ms: since(t0), ok: !!clearance,
    note: !clearance ? "no clearance in this call" : call.lowConfidence ? `confidence ${clearance.confidence.toFixed(2)} below ${threshold}` : undefined,
  };
  emit();

  t0 = performance.now();
  const cs = call.clearance?.callsign ?? (controller ? raw.to : raw.from);
  const track = cs ? tracks.find((tr) => tr.callsign.trim().toUpperCase() === cs) : undefined;
  const tx = call.clearance?.taxiway;
  call.linkedTrackId = track?.id;
  call.linkNote = !track ? (cs ? `no track for ${cs}` : "no callsign heard")
    : track.estimated ? (tx ? `radio only, estimated at ${tx} hold-short` : "radio only, estimated position")
    : `${track.source} track ${track.id}`;
  call.stages.link = { ms: since(t0), ok: !!track, note: call.linkNote };
  emit();
  return call;
};
