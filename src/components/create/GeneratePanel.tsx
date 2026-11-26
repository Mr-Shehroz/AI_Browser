"use client";

import { useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { btn, btnPrimary, input, panel, panelTitle } from "@/components/agent/ui";
import type {
  ClientMessage, CreativeSnapshot, ImageAspect, ImageJob, ImageJobRequest, ImageMode, ImageQuality,
} from "@/shared/types";
import { mediaUrl, uploadImage } from "./media";

export interface ImageForm {
  mode: ImageMode;
  prompt: string;
  negative: string;
  presetId: string;
  model: string;
  quality: ImageQuality;
  aspect: ImageAspect;
  batch: number;
  seed: string;
  strength: number;
  upscaleBy: 2 | 4;
  source: { kind: "image" | "upload"; name: string } | null;
}

export const DEFAULT_FORM: ImageForm = {
  mode: "txt2img",
  prompt: "",
  negative: "",
  presetId: "cinematic",
  model: "",
  quality: "standard",
  aspect: "16:9",
  batch: 1,
  seed: "",
  strength: 0.6,
  upscaleBy: 2,
  source: null,
};

/** Copies a finished job's settings, including the exact seed, so it can be reproduced or varied. */
export function fromJob(job: ImageJob, prev: ImageForm): ImageForm {
  const r = job.request;
  return {
    ...prev,
    mode: r.mode === "upscale" ? prev.mode : r.mode,
    prompt: r.prompt,
    negative: r.negative ?? "",
    presetId: r.presetId ?? "none",
    model: r.model ?? prev.model,
    quality: r.quality,
    aspect: r.aspect,
    batch: r.batch,
    seed: String(job.settings.seed),
    strength: r.strength ?? prev.strength,
  };
}

const MODES: { id: ImageMode; label: string }[] = [
  { id: "txt2img", label: "Create" },
  { id: "img2img", label: "Transform" },
  { id: "upscale", label: "Upscale" },
];
const QUALITIES: { id: ImageQuality; label: string }[] = [
  { id: "draft", label: "Draft" },
  { id: "standard", label: "Standard" },
  { id: "high", label: "High" },
];
const ASPECTS: { id: ImageAspect; label: string }[] = (["1:1", "4:3", "3:4", "16:9", "9:16"] as const).map((a) => ({ id: a, label: a }));
const FIT_LABEL = { good: "runs well", slow: "slow here", too_big: "too big for this GPU" } as const;

function Segmented<T extends string | number>(props: { label: string; options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={props.label} className="flex flex-wrap gap-1 rounded-full border border-steel bg-night/60 p-1">
      {props.options.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          aria-pressed={o.id === props.value}
          onClick={() => props.onChange(o.id)}
          className={`flex-1 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
            o.id === props.value ? "bg-teal text-[#04201d]" : "text-haze hover:text-white"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface Props {
  snapshot: CreativeSnapshot | null;
  form: ImageForm;
  setForm: Dispatch<SetStateAction<ImageForm>>;
  send: (msg: ClientMessage) => void;
  connected: boolean;
}

export function GeneratePanel({ snapshot, form, setForm, send, connected }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const set = <K extends keyof ImageForm>(key: K, value: ImageForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const models = snapshot?.models ?? [];
  const recommended = models.find((m) => m.fits === "good") ?? models.find((m) => m.fits === "slow");
  const model = models.find((m) => m.name === form.model) ?? recommended;
  const maxBatch = snapshot?.limits.maxBatch ?? 1;
  const upscaleOptions = snapshot?.limits.upscaleOptions ?? [2];
  const ready = connected && !!snapshot?.comfy.reachable;
  const needsPrompt = form.mode !== "upscale";
  const needsSource = form.mode !== "txt2img";
  const label = { txt2img: "Generate", img2img: "Transform", upscale: "Upscale" }[form.mode];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (needsPrompt && !form.prompt.trim()) return setError("Write a prompt first.");
    if (needsPrompt && !model) return setError("Install a checkpoint in ComfyUI, then press Rescan.");
    if (needsPrompt && model?.fits === "too_big") return setError("That model is too big for this GPU. Pick a lighter one.");
    if (needsSource && !form.source) return setError("Choose a source image: upload one or pick one from the gallery.");

    let seed: number | undefined;
    if (form.seed.trim()) {
      seed = Number(form.seed);
      if (!Number.isInteger(seed) || seed < 0 || seed > 4_294_967_295) return setError("The seed must be a whole number from 0 to 4294967295.");
    }

    const request: ImageJobRequest = {
      mode: form.mode,
      prompt: needsPrompt ? form.prompt.trim() : "",
      negative: form.negative.trim() || undefined,
      model: needsPrompt ? model?.name : undefined,
      presetId: form.presetId,
      quality: form.quality,
      aspect: form.aspect,
      batch: form.mode === "upscale" ? 1 : Math.min(form.batch, maxBatch),
      seed,
      strength: form.mode === "img2img" ? form.strength : undefined,
      sourceImage: form.source?.kind === "image" ? form.source.name : undefined,
      sourceUploadId: form.source?.kind === "upload" ? form.source.name : undefined,
      upscaleBy: form.mode === "upscale" ? form.upscaleBy : undefined,
    };
    send({ kind: "image_job", request });
  };

  return (
    <form className={`${panel} space-y-4`} onSubmit={submit}>
      <h2 className={panelTitle}>Generate</h2>
      <Segmented label="Mode" options={MODES} value={form.mode} onChange={(v) => set("mode", v)} />

      {needsSource && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-white">Source image</p>
          {form.source ? (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mediaUrl(form.source.kind === "image" ? "images" : "uploads", form.source.name)}
                alt="Selected source"
                className="h-16 w-16 rounded-md border border-steel object-cover"
              />
              <button type="button" className={btn} onClick={() => set("source", null)}>Clear</button>
            </div>
          ) : (
            <p className="text-xs text-dim">Upload an image, or pick one in the gallery and choose Transform this or Upscale.</p>
          )}
          <label className={`${btn} cursor-pointer`}>
            {uploading ? "Uploading…" : "Upload image"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              disabled={uploading}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setUploading(true);
                setError(null);
                try {
                  set("source", { kind: "upload", name: await uploadImage(file) });
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Upload failed.");
                } finally {
                  setUploading(false);
                }
              }}
            />
          </label>
        </div>
      )}

      {needsPrompt && (
        <>
          <textarea
            className={`${input} min-h-24 resize-y text-[15px] leading-relaxed`}
            value={form.prompt}
            onChange={(e) => set("prompt", e.target.value)}
            placeholder="A lighthouse on a cliff at dusk, storm clouds rolling in"
            aria-label="Prompt"
          />

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-semibold text-white">
              Style
              <select className={`${input} mt-1`} value={form.presetId} onChange={(e) => set("presetId", e.target.value)}>
                {(snapshot?.presets ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-white">
              Images per job
              <select className={`${input} mt-1`} value={Math.min(form.batch, maxBatch)} onChange={(e) => set("batch", Number(e.target.value))}>
                {Array.from({ length: maxBatch }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>

          <label className="block text-xs font-semibold text-white">
            Model
            {models.length ? (
              <select className={`${input} mt-1`} value={model?.name ?? ""} onChange={(e) => set("model", e.target.value)}>
                {models.map((m) => (
                  <option key={m.name} value={m.name} disabled={m.fits === "too_big"}>
                    {m.name} ({FIT_LABEL[m.fits]})
                  </option>
                ))}
              </select>
            ) : (
              <span className="mt-1 block font-normal text-dim">No models found. Add a checkpoint to ComfyUI&apos;s models/checkpoints folder.</span>
            )}
          </label>
          {model && <p className="-mt-2 text-xs text-dim">{model.note}</p>}

          <Segmented label="Quality" options={QUALITIES} value={form.quality} onChange={(v) => set("quality", v)} />
          <Segmented label="Aspect ratio" options={ASPECTS} value={form.aspect} onChange={(v) => set("aspect", v)} />

          {form.mode === "img2img" && (
            <label className="block text-xs font-semibold text-white">
              How much to change: {Math.round(form.strength * 100)}%
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={form.strength}
                onChange={(e) => set("strength", Number(e.target.value))}
                className="mt-2 w-full accent-[var(--color-teal)]"
              />
            </label>
          )}

          <details>
            <summary className="cursor-pointer text-xs font-semibold text-teal">Advanced</summary>
            <div className="mt-3 space-y-2">
              <input className={input} value={form.negative} onChange={(e) => set("negative", e.target.value)} placeholder="Things to avoid, such as people, text" aria-label="Negative prompt" />
              <input className={input} value={form.seed} onChange={(e) => set("seed", e.target.value)} placeholder="Seed (leave empty for random)" inputMode="numeric" aria-label="Seed" />
            </div>
          </details>
        </>
      )}

      {form.mode === "upscale" && (
        <>
          <Segmented
            label="Upscale factor"
            options={upscaleOptions.map((n) => ({ id: n as 2 | 4, label: `${n}×` }))}
            value={form.upscaleBy}
            onChange={(v) => set("upscaleBy", v)}
          />
          <p className="text-xs leading-relaxed text-dim">
            {snapshot?.upscaleModels.length
              ? `Uses ${snapshot.upscaleModels[0]}.`
              : "No upscale model installed, so this uses plain resizing. Add one (such as 4x-UltraSharp) to ComfyUI's models/upscale_models folder for sharper results."}
          </p>
        </>
      )}

      {error && <p className="text-sm text-ember" role="alert">{error}</p>}
      {!ready && <p className="text-xs text-amber">ComfyUI isn&apos;t connected. See This machine below.</p>}

      <button className={`${btnPrimary} w-full py-2.5 text-base`} disabled={!ready || uploading}>{label}</button>
    </form>
  );
}