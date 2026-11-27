"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { encodeWav, resampleTo16k } from "./voice";

interface Session {
  ctx: AudioContext;
  stream: MediaStream;
  src: MediaStreamAudioSourceNode;
  proc: ScriptProcessorNode;
  chunks: Float32Array[];
  timer: ReturnType<typeof setInterval>;
  onDone: (wav: Blob | null) => void;
}

/** Records the microphone only between start() and stop(). Nothing is captured otherwise. */
export function useRecorder(maxSeconds = 60) {
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const session = useRef<Session | null>(null);

  const stop = useCallback(() => {
    const s = session.current;
    if (!s) return;
    session.current = null;
    clearInterval(s.timer);
    s.proc.disconnect();
    s.src.disconnect();
    s.stream.getTracks().forEach((t) => t.stop());
    const rate = s.ctx.sampleRate;
    void s.ctx.close();
    setRecording(false);
    setLevel(0);

    const total = s.chunks.reduce((n, c) => n + c.length, 0);
    const merged = new Float32Array(total);
    let offset = 0;
    for (const c of s.chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    const pcm = rate === 16000 ? merged : resampleTo16k(merged, rate);
    s.onDone(pcm.length < 16000 * 0.3 ? null : encodeWav(pcm, 16000));
  }, []);

  const start = useCallback(async (onDone: (wav: Blob | null) => void) => {
    if (session.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ sampleRate: 16000 });
    } catch {
      ctx = new AudioContext();
    }
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];
    proc.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(d));
      let sum = 0;
      for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
      setLevel(Math.min(1, Math.sqrt(sum / d.length) * 6));
    };
    src.connect(proc);
    proc.connect(ctx.destination);

    const started = Date.now();
    const timer = setInterval(() => {
      const secs = (Date.now() - started) / 1000;
      setSeconds(secs);
      if (secs >= maxSeconds) stop();
    }, 200);

    session.current = { ctx, stream, src, proc, chunks, timer, onDone };
    setSeconds(0);
    setRecording(true);
  }, [maxSeconds, stop]);

  // Release the microphone if the page is left mid-recording.
  useEffect(() => () => {
    if (session.current) {
      session.current.onDone = () => {};
      stop();
    }
  }, [stop]);

  return { recording, level, seconds, start, stop };
}