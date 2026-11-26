"use client";

import { useEffect, useRef } from "react";

const pad = (n: number) => String(n).padStart(2, "0");

/** 24 fps session timecode. Writes to the DOM directly so nothing else re-renders. */
export function Timecode({ running }: { running: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!running) {
      if (ref.current) ref.current.textContent = "00:00:00:00";
      return;
    }
    const start = performance.now();
    const id = setInterval(() => {
      const t = performance.now() - start;
      const s = Math.floor(t / 1000);
      const f = Math.floor((t % 1000) / (1000 / 24));
      if (ref.current) {
        ref.current.textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f)}`;
      }
    }, 1000 / 24);
    return () => clearInterval(id);
  }, [running]);

  return (
    <span ref={ref} aria-hidden className="font-display text-lg font-semibold tabular-nums tracking-wider text-amber">
      00:00:00:00
    </span>
  );
}