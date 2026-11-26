"use client";

import { btn, panel, panelTitle } from "@/components/agent/ui";
import type { ImageJob } from "@/shared/types";
import { mediaUrl } from "./media";

export interface Selection { jobId: string; image: string }

interface Props {
  jobs: ImageJob[];
  selected: Selection | null;
  onSelect: (s: Selection) => void;
  onCancel: (jobId: string) => void;
}

export function Gallery({ jobs, selected, onSelect, onCancel }: Props) {
  const pending = jobs.filter((j) => j.status === "queued" || j.status === "running");
  const failed = jobs.filter((j) => j.status === "failed").slice(0, 3);
  const images = jobs.filter((j) => j.status === "done").flatMap((j) => j.images.map((img) => ({ job: j, img })));

  return (
    <div className={`${panel} space-y-4`}>
      <div className="flex items-baseline justify-between">
        <h2 className={panelTitle}>Gallery</h2>
        <span className="text-xs text-dim">{images.length} {images.length === 1 ? "image" : "images"}</span>
      </div>

      {pending.map((j) => (
        <div key={j.id} className="frame-card flex items-center gap-3" data-status={j.status === "running" ? "running" : "pending_approval"}>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{j.request.prompt || "Upscale"}</p>
            <p className="text-xs text-dim">
              {j.status === "running" ? `Rendering, ${Math.round(j.progress * 100)}%` : "Queued"}
              {j.note ? `. ${j.note}` : ""}
            </p>
          </div>
          <button className={btn} onClick={() => onCancel(j.id)}>Cancel</button>
        </div>
      ))}

      {failed.map((j) => (
        <div key={j.id} className="frame-card" data-status="failed">
          <p className="truncate text-sm font-semibold text-white">{j.request.prompt || "Upscale"}</p>
          <p className="text-xs text-ember">{j.error}</p>
        </div>
      ))}

      {images.length === 0 ? (
        <p className="text-sm text-dim">Finished images land here, newest first, with the settings and seed used for each.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {images.map(({ job, img }) => {
            const isSelected = selected?.image === img;
            return (
              <li key={img}>
                <button
                  onClick={() => onSelect({ jobId: job.id, image: img })}
                  aria-pressed={isSelected}
                  aria-label={`Show ${job.request.prompt || "upscaled image"}`}
                  className={`block w-full overflow-hidden rounded-lg border transition-colors ${
                    isSelected ? "border-teal shadow-[0_0_20px_-6px_var(--color-teal)]" : "border-white/5 hover:border-steel"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mediaUrl("images", img)} alt="" loading="lazy" className="aspect-square w-full object-cover" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}