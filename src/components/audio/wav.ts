// Mic utterances go to whisper.cpp, which reads WAV only (it answers webm with 400), so the browser converts first.

/** 16-bit PCM mono WAV from float samples in [-1, 1]. */
export function pcm16Wav(samples: Float32Array, rate: number): ArrayBuffer {
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const tag = (at: number, s: string) => [...s].forEach((c, i) => out.setUint8(at + i, c.charCodeAt(0)));
  tag(0, "RIFF"); out.setUint32(4, 36 + samples.length * 2, true); tag(8, "WAVE");
  tag(12, "fmt "); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  tag(36, "data"); out.setUint32(40, samples.length * 2, true);
  samples.forEach((x, i) => out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * 0x7fff, true));
  return out.buffer;
}

/** Recorded browser audio (webm/opus) -> 16 kHz mono WAV blob. */
export async function toWav16k(recorded: Blob): Promise<Blob> {
  const decoded = await new AudioContext().decodeAudioData(await recorded.arrayBuffer());
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  return new Blob([pcm16Wav((await off.startRendering()).getChannelData(0), 16000)], { type: "audio/wav" });
}
