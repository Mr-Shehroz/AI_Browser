import { AGENT_HTTP_URL } from "@/components/knowledge/agentHttp";
import type { TranscriptResult, VoiceLanguage } from "@/shared/types";

/** Linear resampling to 16 kHz, used only if the browser didn't record at 16 kHz already. */
export function resampleTo16k(input: Float32Array, rate: number): Float32Array {
  const ratio = rate / 16000;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const t = pos - i0;
    out[i] = input[i0] * (1 - t) + input[i1] * t;
  }
  return out;
}

/** 16-bit mono PCM WAV, the format whisper.cpp reads directly. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export async function transcribe(wav: Blob, lang: VoiceLanguage): Promise<TranscriptResult> {
  const res = await fetch(`${AGENT_HTTP_URL}/voice/transcribe?lang=${lang}`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: wav,
  });
  const data = (await res.json().catch(() => ({}))) as TranscriptResult & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Transcription failed (${res.status}).`);
  return data;
}

/** Urdu speech made by Piper on this computer. */
export async function synthesizeUrdu(text: string): Promise<Blob> {
  const res = await fetch(`${AGENT_HTTP_URL}/voice/speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Speech failed (${res.status}).`);
  }
  return res.blob();
}