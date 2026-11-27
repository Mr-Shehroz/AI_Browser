"use client";

import { useEffect, useRef, useState } from "react";
import { encodeWav, resampleTo16k } from "./voice";

interface Options {
  enabled: boolean;
  /** While true (agent speaking or transcribing), audio is ignored. */
  paused: boolean;
  onSegment: (wav: Blob) => void;
  onError: (message: string) => void;
}

const FRAME = 1024;
const SILENCE_MS = 900;
const MIN_SPEECH_MS = 500;
const MAX_SEGMENT_MS = 30_000;
const PREROLL_FRAMES = 5;

/** Continuous listening that cuts speech into segments at natural pauses. Only runs while enabled. */
export function useHandsFree({ enabled, paused, onSegment, onError }: Options) {
  const [listening, setListening] = useState(false);
  const [inSpeech, setInSpeech] = useState(false);
  const [level, setLevel] = useState(0);
  const pausedRef = useRef(paused);
  const onSegmentRef = useRef(onSegment);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    pausedRef.current = paused;
    onSegmentRef.current = onSegment;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let src: MediaStreamAudioSourceNode | null = null;
    let proc: ScriptProcessorNode | null = null;

    void (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        let audio: AudioContext;
        try {
          audio = new AudioContext({ sampleRate: 16000 });
        } catch {
          audio = new AudioContext();
        }
        ctx = audio;
        const rate = audio.sampleRate;
        const frameMs = (FRAME / rate) * 1000;
        const source = audio.createMediaStreamSource(s);
        const node = audio.createScriptProcessor(FRAME, 1, 1);
        src = source;
        proc = node;

        let noise = 0.01;
        let speaking = false;
        let loudFrames = 0;
        let silentMs = 0;
        let speechMs = 0;
        let preroll: Float32Array[] = [];
        let segment: Float32Array[] = [];
        let lastLevelAt = 0;

        node.onaudioprocess = (e) => {
          const d = new Float32Array(e.inputBuffer.getChannelData(0));
          let sum = 0;
          for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
          const rms = Math.sqrt(sum / d.length);

          const now = performance.now();
          if (now - lastLevelAt > 100) {
            lastLevelAt = now;
            setLevel(Math.min(1, rms * 6));
          }

          if (pausedRef.current) {
            if (speaking) setInSpeech(false);
            speaking = false;
            segment = [];
            preroll = [];
            loudFrames = 0;
            return;
          }

          const threshold = Math.max(0.012, noise * 3);
          if (!speaking) {
            noise = noise * 0.95 + Math.min(rms, 0.05) * 0.05; // learn the room's background level
            preroll.push(d);
            if (preroll.length > PREROLL_FRAMES) preroll.shift();
            loudFrames = rms > threshold ? loudFrames + 1 : 0;
            if (loudFrames >= 2) {
              speaking = true;
              setInSpeech(true);
              segment = [...preroll];
              preroll = [];
              silentMs = 0;
              speechMs = loudFrames * frameMs;
            }
            return;
          }

          segment.push(d);
          if (rms > threshold) {
            silentMs = 0;
            speechMs += frameMs;
          } else {
            silentMs += frameMs;
          }

          if (silentMs >= SILENCE_MS || segment.length * frameMs >= MAX_SEGMENT_MS) {
            speaking = false;
            setInSpeech(false);
            loudFrames = 0;
            const parts = segment;
            segment = [];
            if (speechMs < MIN_SPEECH_MS) return;
            const total = parts.reduce((n, c) => n + c.length, 0);
            const merged = new Float32Array(total);
            let offset = 0;
            for (const c of parts) {
              merged.set(c, offset);
              offset += c.length;
            }
            const pcm = rate === 16000 ? merged : resampleTo16k(merged, rate);
            onSegmentRef.current(encodeWav(pcm, 16000));
          }
        };

        source.connect(node);
        node.connect(audio.destination);
        setListening(true);
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        onErrorRef.current(
          name === "NotAllowedError"
            ? "Microphone access is blocked. Allow it from the icon at the left of Chrome's address bar."
            : name === "NotFoundError"
              ? "No microphone was found."
              : "Couldn't start the microphone.",
        );
      }
    })();

    return () => {
      cancelled = true;
      proc?.disconnect();
      src?.disconnect();
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
      setListening(false);
      setInSpeech(false);
      setLevel(0);
    };
  }, [enabled]);

  return { listening, inSpeech, level };
}