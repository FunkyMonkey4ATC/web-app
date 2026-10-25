// npx tsx src/components/audio/wav.check.ts
import assert from "node:assert";
import { pcm16Wav } from "./wav";

const wav = new DataView(pcm16Wav(new Float32Array([0, 1, -1, 2]), 16000));
const str = (at: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => wav.getUint8(at + i)));
assert.equal(str(0), "RIFF"); assert.equal(str(8), "WAVE"); assert.equal(str(36), "data");
assert.equal(wav.getUint32(24, true), 16000);            // sample rate
assert.equal(wav.getUint16(22, true), 1);                // mono
assert.equal(wav.getUint32(40, true), 8);                // 4 samples x 2 bytes
assert.equal(wav.byteLength, 52);
assert.deepEqual([0, 1, 2, 3].map((i) => wav.getInt16(44 + i * 2, true)), [0, 32767, -32767, 32767]); // clipped
console.log("wav ok");
