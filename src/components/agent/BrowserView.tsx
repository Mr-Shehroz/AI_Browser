"use client";

import { useEffect, useRef, useState } from "react";
import { Timecode } from "./Timecode";

export type StageMood = "idle" | "running" | "approval" | "paused" | "alert";

interface Props {
  subscribe: (fn: (data: string) => void) => () => void;
  browserOpen: boolean;
  connected: boolean;
  url?: string;
  mood: StageMood;
  thinking: boolean;
  subtitle?: string;
  onStart: () => void;
}

export function BrowserView({ subscribe, browserOpen, connected, url, mood, thinking, subtitle, onStart }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const glowRef = useRef<HTMLImageElement>(null);
  const lastGlow = useRef(0);
  const [hasFrame, setHasFrame] = useState(false);

  useEffect(
    () =>
      subscribe((data) => {
        const src = `data:image/jpeg;base64,${data}`;
        if (imgRef.current) imgRef.current.src = src;
        const now = performance.now();
        if (glowRef.current && now - lastGlow.current > 250) {
          glowRef.current.src = src; // ambient glow updates ~4x/sec
          lastGlow.current = now;
        }
        setHasFrame(true);
      }),
    [subscribe],
  );

  const live = browserOpen && hasFrame;

  return (
    <div className="stage" data-mood={mood}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={glowRef} alt="" aria-hidden className={`stage-glow ${live ? "" : "hidden"}`} />

      <div className="stage-frame letterbox">
        <div className="stage-bar">
          <span className={`rec-dot ${live ? "is-live" : ""}`} aria-hidden />
          <span className="font-display text-lg font-bold tracking-wide text-white">{live ? "Live" : "Standby"}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-dim">{url ?? "No page open"}</span>
          <Timecode running={live} />
        </div>

        <div className="relative aspect-[1280/800] w-full bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={imgRef} alt="Live view of the agent's browser" className={`h-full w-full object-contain ${live ? "" : "invisible"}`} />

          {thinking && live && <div className="scan" aria-hidden />}
          <span className="vf-corner vf-tl" aria-hidden />
          <span className="vf-corner vf-tr" aria-hidden />
          <span className="vf-corner vf-bl" aria-hidden />
          <span className="vf-corner vf-br" aria-hidden />

          {subtitle && live && (
            <p key={subtitle} className="subtitle" aria-live="polite">{subtitle}</p>
          )}

          {!live && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center">
              <div className="max-w-xl">
                <h1 className="font-display text-5xl font-black leading-[0.95] text-white sm:text-7xl">
                  {browserOpen ? "Waiting for the first frame" : "Ready for a goal"}
                </h1>
                <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-haze/80">
                  {browserOpen
                    ? "If the Chromium window is minimized, restore it so the picture keeps streaming."
                    : "Write a goal on the right, or open the browser and drive it yourself. The agent plans first, asks before anything risky, and hands control back whenever you pause."}
                </p>
                {!browserOpen && (
                  <button className="cine-btn cine-btn-primary mt-6 px-6 py-2.5 text-base" disabled={!connected} onClick={onStart}>
                    Open browser
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}