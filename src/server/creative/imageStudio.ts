import { randomInt, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  CreativeModel, CreativeSnapshot, HardwareInfo, ImageJob, ImageJobRequest, ImageSettings, ServerMessage,
} from "../../shared/types";
import type { AuditLog } from "../audit/auditLog";
import { UPLOAD_NAME } from "../http/mediaServer";
import { readJson, writeJson } from "../knowledge/util";
import type { OllamaClient } from "../llm/ollamaClient";
import type { ComfyClient, ComfyHistoryEntry, ComfyImageRef } from "./comfyClient";
import { detectHardware } from "./hardware";
import { BASE_NEGATIVE, describeModel, limitsFor, PRESETS, recommendationFor, settingsFor } from "./profiles";
import { img2imgGraph, txt2imgGraph, upscaleGraph, type ComfyGraph } from "./workflows";

interface Deps {
  comfy: ComfyClient;
  llm: OllamaClient;
  audit: AuditLog;
  emit: (msg: ServerMessage) => void;
  root: string;
  imagesDir: string;
  uploadsDir: string;
  shareGpu: "auto" | "always" | "never";
  minFreeDiskGb: number;
  isAgentBusy: () => boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const IMAGE_NAME = /^[\w-]+\.png$/;
const WAITING_NOTE = "Waiting for the browser agent to finish thinking (they share the GPU)";

function friendlyError(message: string): string {
  if (/out of memory|OOM|CUDA error|allocate/i.test(message)) {
    return "The GPU ran out of memory. Try Draft quality, one image per job, or a lighter model.";
  }
  return message;
}

function comfyError(entry: ComfyHistoryEntry): string | undefined {
  const err = entry.status?.messages?.find(([type]) => type === "execution_error")?.[1];
  return typeof err?.exception_message === "string" ? err.exception_message : undefined;
}

function collectImages(entry: ComfyHistoryEntry): ComfyImageRef[] {
  return Object.values(entry.outputs ?? {})
    .flatMap((o) => o.images ?? [])
    .filter((i) => i.type === "output");
}

export class ImageStudio {
  private jobs: ImageJob[] = [];
  private queue: string[] = [];
  private processing = false;
  private hardware: HardwareInfo | null = null;
  private models: CreativeModel[] = [];
  private upscaleModels: string[] = [];
  private comfyState: CreativeSnapshot["comfy"] = { reachable: false, url: "" };
  private cancelled = new Set<string>();
  private jobsFile: string;

  constructor(private d: Deps) {
    this.jobsFile = path.join(d.root, "jobs.json");
  }

  async init(): Promise<void> {
    await mkdir(this.d.imagesDir, { recursive: true });
    await mkdir(this.d.uploadsDir, { recursive: true });
    const saved = (await readJson<ImageJob[]>(this.jobsFile)) ?? [];
    this.jobs = saved.map((j) =>
      j.status === "queued" || j.status === "running"
        ? { ...j, status: "failed", error: "Interrupted when the agent server stopped.", finishedAt: j.finishedAt ?? now() }
        : j,
    );
    this.d.comfy.onProgress((p) => {
      const job = this.jobs.find((j) => j.promptId === p.promptId && j.status === "running");
      if (job && p.max > 0) {
        job.progress = p.value / p.max;
        this.emitJob(job);
      }
    });
    await this.refresh(true);
  }

  get reachable(): boolean {
    return this.comfyState.reachable;
  }

  /** Re-detects ComfyUI, its installed models and (when asked) the hardware. */
  async refresh(rescan = false): Promise<void> {
    const url = await this.d.comfy.detect();
    if (url) {
      try {
        const [stats, ckpts, ups] = await Promise.all([
          this.d.comfy.systemStats(),
          this.d.comfy.listCheckpoints(),
          this.d.comfy.listUpscaleModels().catch(() => [] as string[]),
        ]);
        this.comfyState = { reachable: true, url, version: stats.system?.comfyui_version };
        if (rescan || !this.hardware || this.hardware.source !== "comfyui") {
          this.hardware = await detectHardware(this.d.root, stats);
        }
        this.upscaleModels = ups;
        this.models = ckpts.map((name) => describeModel(name, this.hardware));
      } catch (err) {
        this.comfyState = { reachable: false, url, error: errMsg(err) };
      }
    } else {
      this.comfyState = { reachable: false, url: this.d.comfy.candidates.join(" or "), error: "ComfyUI isn't running." };
      this.models = [];
      if (rescan || !this.hardware) this.hardware = await detectHardware(this.d.root);
    }
    this.d.emit({ kind: "creative", snapshot: this.snapshot() });
  }

  snapshot(): CreativeSnapshot {
    return {
      comfy: this.comfyState,
      hardware: this.hardware,
      models: this.models,
      upscaleModels: this.upscaleModels,
      presets: PRESETS,
      limits: limitsFor(this.hardware?.tier ?? "cpu"),
      recommendation: recommendationFor(this.hardware),
      jobs: this.jobs.slice(0, 200),
    };
  }

  private shouldShareGpu(): boolean {
    if (this.d.shareGpu === "always") return true;
    if (this.d.shareGpu === "never") return false;
    const tier = this.hardware?.tier ?? "cpu";
    return tier === "cpu" || tier === "low" || tier === "mid";
  }

  private resolveSource(req: ImageJobRequest): string {
    if (req.sourceImage) {
      if (!IMAGE_NAME.test(req.sourceImage)) throw new Error("Invalid gallery image.");
      const p = path.join(this.d.imagesDir, req.sourceImage);
      if (!existsSync(p)) throw new Error("That gallery image no longer exists.");
      return p;
    }
    if (req.sourceUploadId) {
      if (!UPLOAD_NAME.test(req.sourceUploadId)) throw new Error("Invalid upload.");
      const p = path.join(this.d.uploadsDir, req.sourceUploadId);
      if (!existsSync(p)) throw new Error("That upload no longer exists. Upload it again.");
      return p;
    }
    throw new Error("Choose a source image first.");
  }

  enqueue(req: ImageJobRequest): ImageJob {
    if (!this.comfyState.reachable) throw new Error("ComfyUI isn't connected. Start it, then press Rescan.");
    const tier = this.hardware?.tier ?? "cpu";
    const limits = limitsFor(tier);
    if (req.batch > limits.maxBatch) throw new Error(`This machine handles up to ${limits.maxBatch} image(s) per job.`);

    let settings: ImageSettings;
    if (req.mode === "upscale") {
      const by = req.upscaleBy ?? 2;
      if (!limits.upscaleOptions.includes(by)) throw new Error(`This machine supports ${limits.upscaleOptions.join("× or ")}× upscaling.`);
      this.resolveSource(req);
      settings = {
        width: 0, height: 0, steps: 0, cfg: 0, sampler: "", scheduler: "", seed: 0, family: "unknown",
        upscaleBy: by, upscaleModel: this.upscaleModels[0],
      };
    } else {
      if (!req.prompt.trim()) throw new Error("Write a prompt first.");
      const model = this.models.find((m) => m.name === req.model);
      if (!model) throw new Error("Pick a model that's installed in ComfyUI.");
      if (model.fits === "too_big") throw new Error(`${model.name} needs more GPU memory than this machine has. Pick a lighter model.`);
      if (req.mode === "img2img") this.resolveSource(req);
      const s = settingsFor(model.family, req.quality, tier, req.aspect, model.name);
      settings = { ...s, seed: req.seed ?? randomInt(0, 4_294_967_295), family: model.family };
    }

    const job: ImageJob = {
      id: `img-${Date.now()}-${randomUUID().slice(0, 6)}`,
      request: req,
      settings,
      status: "queued",
      progress: 0,
      images: [],
      createdAt: now(),
    };
    this.jobs.unshift(job);
    this.queue.push(job.id);
    void this.save();
    this.emitJob(job);
    void this.d.audit.write("image_job_queued", { id: job.id, mode: req.mode, model: req.model, settings });
    void this.process();
    return job;
  }

  async cancel(jobId: string): Promise<void> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) throw new Error("Job not found.");
    if (job.status === "queued") {
      this.queue = this.queue.filter((id) => id !== jobId);
      Object.assign(job, { status: "cancelled", finishedAt: now(), note: undefined });
      await this.save();
      this.emitJob(job);
    } else if (job.status === "running") {
      this.cancelled.add(jobId);
      await this.d.comfy.interrupt().catch(() => {});
    }
  }

  private async process(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length) {
        const job = this.jobs.find((j) => j.id === this.queue[0]);
        if (!job || job.status !== "queued") {
          this.queue.shift();
          continue;
        }
        const share = this.shouldShareGpu();
        if (share && this.d.isAgentBusy()) {
          if (job.note !== WAITING_NOTE) {
            job.note = WAITING_NOTE;
            this.emitJob(job);
          }
          await sleep(3000);
          continue;
        }
        this.queue.shift();
        job.note = undefined;
        await this.run(job, share);
      }
    } finally {
      this.processing = false;
    }
  }

  private async checkDisk(): Promise<void> {
    try {
      const s = await statfs(this.d.root);
      const freeGb = (s.bavail * s.bsize) / 1024 ** 3;
      if (freeGb < this.d.minFreeDiskGb) {
        throw new Error(`Only ${freeGb.toFixed(1)} GB of disk space left. Free some space before generating more images.`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("disk space")) throw err;
    }
  }

  private async buildGraph(job: ImageJob): Promise<ComfyGraph> {
    const r = job.request;
    const s = job.settings;

    if (r.mode === "upscale") {
      const src = this.resolveSource(r);
      const name = await this.d.comfy.uploadImage(src, `${job.id}-src${path.extname(src)}`);
      return upscaleGraph(name, s.upscaleBy ?? 2, s.upscaleModel);
    }

    const preset = PRESETS.find((p) => p.id === r.presetId);
    const positive = [r.prompt.trim(), preset?.prompt].filter(Boolean).join(", ");
    const negative = s.family === "flux" ? "" : [r.negative?.trim(), preset?.negative, BASE_NEGATIVE].filter(Boolean).join(", ");
    const args = {
      ckpt: r.model!, positive, negative, width: s.width, height: s.height, steps: s.steps, cfg: s.cfg,
      sampler: s.sampler, scheduler: s.scheduler, seed: s.seed, batch: r.batch,
    };

    if (r.mode === "img2img") {
      const src = this.resolveSource(r);
      const name = await this.d.comfy.uploadImage(src, `${job.id}-src${path.extname(src)}`);
      return img2imgGraph({ ...args, image: name, denoise: r.strength ?? 0.6 });
    }
    return txt2imgGraph(args);
  }

  private async waitForResult(job: ImageJob): Promise<ComfyImageRef[]> {
    const limitMs = (this.hardware?.tier === "cpu" ? 60 : 20) * 60_000;
    const start = Date.now();
    while (Date.now() - start < limitMs) {
      if (this.cancelled.has(job.id)) throw new Error("Cancelled.");
      await sleep(1500);
      const entry = await this.d.comfy.history(job.promptId!).catch(() => null);
      if (!entry) continue;
      if (entry.status?.status_str === "error") throw new Error(comfyError(entry) ?? "ComfyUI reported an error.");
      if (entry.status?.completed) return collectImages(entry);
    }
    await this.d.comfy.interrupt().catch(() => {});
    throw new Error("The job took too long and was stopped. Try Draft quality or a lighter model.");
  }

  private async run(job: ImageJob, share: boolean): Promise<void> {
    Object.assign(job, { status: "running", startedAt: now(), progress: 0 });
    this.emitJob(job);
    try {
      await this.checkDisk();
      if (share) {
        job.note = "Freeing GPU memory from the language model";
        this.emitJob(job);
        await this.d.llm.unloadAll().catch(() => {});
        job.note = undefined;
      }
      const graph = await this.buildGraph(job);
      job.promptId = await this.d.comfy.queuePrompt(graph);
      this.emitJob(job);

      const outputs = await this.waitForResult(job);
      const names: string[] = [];
      for (const [i, ref] of outputs.entries()) {
        const name = `${job.id}-${i + 1}.png`;
        await writeFile(path.join(this.d.imagesDir, name), await this.d.comfy.viewImage(ref));
        names.push(name);
      }
      if (!names.length) throw new Error("ComfyUI finished but returned no images.");

      const finishedAt = now();
      Object.assign(job, {
        status: "done", images: names, progress: 1, finishedAt,
        durationMs: Date.parse(finishedAt) - Date.parse(job.startedAt!),
      });
    } catch (err) {
      if (this.cancelled.has(job.id)) Object.assign(job, { status: "cancelled", finishedAt: now() });
      else Object.assign(job, { status: "failed", error: friendlyError(errMsg(err)), finishedAt: now() });
    } finally {
      this.cancelled.delete(job.id);
      job.note = undefined;
      if (share) await this.d.comfy.free().catch(() => {});
      await this.save();
      this.emitJob(job);
      void this.d.audit.write(`image_job_${job.status}`, { id: job.id, mode: job.request.mode, model: job.request.model, error: job.error, durationMs: job.durationMs });
    }
  }

  private async save(): Promise<void> {
    await writeJson(this.jobsFile, this.jobs.slice(0, 500)).catch(() => {});
  }

  private emitJob(job: ImageJob): void {
    this.d.emit({ kind: "image_job_update", job: { ...job } });
  }
}