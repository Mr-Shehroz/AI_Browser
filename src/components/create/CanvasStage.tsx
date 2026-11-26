"use client";

import { btn } from "@/components/agent/ui";
import type { ImageJob } from "@/shared/types";
import { mediaUrl } from "./media";

interface Props {
  job: ImageJob | null;
  image: string | null;
  active: ImageJob | null;
  onTransform: (image: string) => void;
  onUpscale: (image: string) => void;
  onReuse: (job: ImageJob) => void;
}

function describe(job: ImageJob): string {
  const s = job.settings;
  const secs = job.durationMs ? `, ${Math.round(job.durationMs / 1000)}s` : "";
  if (job.request.mode === "upscale") return `Upscaled ${s.upscaleBy}×${s.upscaleModel ? ` with ${s.upscaleModel}` : ""}${secs}`;
  return `${s.width}×${s.height}, ${s.steps} steps, seed ${s.seed}, ${job.request.model}${secs}`;
}

export function CanvasStage({ job, image, active, onTransform, onUpscale, onReuse }: Props) {
  const src = image ? mediaUrl("images", image) : null;
  const mood = active ? "running" : job?.status === "failed" ? "alert" : "idle";
  const caption = active
    ? active.note ?? (active.request.prompt || "Upscaling")
    : job
      ? job.request.prompt || "Upscaled image"
      : "Nothing selected";

  return (
    <div>
      <div className="stage" data-mood={mood}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src && <img src={src} alt="" aria-hidden className="stage-glow" />}

        <div className="stage-frame letterbox">
          <div className="stage-bar">
            <span className={`rec-dot ${active ? "is-live" : ""}`} aria-hidden />
            <span className="font-display text-lg font-bold tracking-wide text-white">
              {active ? `Rendering ${Math.round(active.progress * 100)}%` : "Canvas"}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-dim">{caption}</span>
          </div>

          <div className="relative aspect-video w-full bg-black">
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt={job?.request.prompt || "Generated image"} className="h-full w-full object-contain" />
            ) : (
              <div className="absolute inset-0 grid place-items-center p-6 text-center">
                <div className="max-w-xl">
                  <h1 className="font-display text-5xl font-black leading-[0.95] text-white sm:text-7xl">Make the first frame</h1>
                  <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-haze/80">
                    Describe an image on the right. Settings adapt to this machine&apos;s GPU, so the same prompt works on a
                    laptop and on a workstation.
                  </p>
                </div>
              </div>
            )}

            {active && <div className="scan" aria-hidden />}
            <span className="vf-corner vf-tl" aria-hidden />
            <span className="vf-corner vf-tr" aria-hidden />
            <span className="vf-corner vf-bl" aria-hidden />
            <span className="vf-corner vf-br" aria-hidden />

            {active && (
              <div className="absolute inset-x-0 bottom-0 z-[4] h-1 bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(active.progress * 100)}>
                <div className="h-full bg-teal transition-[width] duration-500" style={{ width: `${active.progress * 100}%` }} />
              </div>
            )}
          </div>
        </div>
      </div>

      {job && image && job.status === "done" && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button className={btn} onClick={() => onTransform(image)}>Transform this</button>
          <button className={btn} onClick={() => onUpscale(image)}>Upscale</button>
          {job.request.mode !== "upscale" && <button className={btn} onClick={() => onReuse(job)}>Reuse settings</button>}
          <a className={btn} href={mediaUrl("images", image)} target="_blank" rel="noreferrer">Open full size</a>
          <p className="ml-auto text-xs text-dim">{describe(job)}</p>
        </div>
      )}
    </div>
  );
}