import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { WebSocket } from "ws";

export interface ComfySystemStats {
  system?: { comfyui_version?: string; os?: string };
  devices?: { name: string; type: string; vram_total: number; vram_free: number }[];
}

export interface ComfyImageRef { filename: string; subfolder: string; type: string }

export interface ComfyHistoryEntry {
  status?: { status_str?: string; completed?: boolean; messages?: [string, Record<string, unknown>][] };
  outputs?: Record<string, { images?: ComfyImageRef[] }>;
}

type ProgressFn = (p: { promptId: string; value: number; max: number }) => void;

/** Thin client for ComfyUI's local HTTP + WebSocket API. */
export class ComfyClient {
  baseUrl: string | null = null;
  private readonly clientId = randomUUID();
  private ws: WebSocket | null = null;
  private listeners = new Set<ProgressFn>();

  constructor(readonly candidates: string[]) {}

  async detect(): Promise<string | null> {
    for (const url of this.candidates) {
      try {
        const res = await fetch(`${url}/system_stats`, { signal: AbortSignal.timeout(2000) });
        if (!res.ok) continue;
        if (this.baseUrl !== url) {
          this.ws?.close();
          this.ws = null;
        }
        this.baseUrl = url;
        this.ensureEvents();
        return url;
      } catch {
        // try the next candidate
      }
    }
    this.baseUrl = null;
    return null;
  }

  private u(p: string): string {
    if (!this.baseUrl) throw new Error("ComfyUI isn't connected.");
    return `${this.baseUrl}${p}`;
  }

  private async json<T>(p: string, init?: RequestInit): Promise<T> {
    const res = await fetch(this.u(p), { ...init, signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    if (!res.ok) throw new Error(`ComfyUI ${p} returned ${res.status}: ${text.slice(0, 500)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  systemStats(): Promise<ComfySystemStats> {
    return this.json<ComfySystemStats>("/system_stats");
  }

  /** Reads a dropdown's options; supports both the classic and the newer COMBO format. */
  private async comboOptions(node: string, input: string): Promise<string[]> {
    const info = await this.json<Record<string, { input?: { required?: Record<string, unknown[]> } }>>(`/object_info/${node}`);
    const spec = info[node]?.input?.required?.[input];
    if (!Array.isArray(spec)) return [];
    if (Array.isArray(spec[0])) return spec[0] as string[];
    const options = (spec[1] as { options?: string[] } | undefined)?.options;
    return Array.isArray(options) ? options : [];
  }

  listCheckpoints(): Promise<string[]> {
    return this.comboOptions("CheckpointLoaderSimple", "ckpt_name");
  }

  listUpscaleModels(): Promise<string[]> {
    return this.comboOptions("UpscaleModelLoader", "model_name");
  }

  /** Copies a local image into ComfyUI's input folder and returns the name LoadImage expects. */
  async uploadImage(filePath: string, name: string): Promise<string> {
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array(await readFile(filePath))]), name);
    form.append("overwrite", "true");
    const r = await this.json<{ name: string; subfolder?: string }>("/upload/image", { method: "POST", body: form });
    return r.subfolder ? `${r.subfolder}/${r.name}` : r.name;
  }

  async queuePrompt(graph: object): Promise<string> {
    const res = await fetch(this.u("/prompt"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: graph, client_id: this.clientId }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      prompt_id?: string;
      error?: { message?: string };
      node_errors?: Record<string, { errors?: { message: string; details?: string }[] }>;
    };
    if (!res.ok || !data.prompt_id) {
      const nodeErrors = Object.values(data.node_errors ?? {})
        .flatMap((n) => n.errors ?? [])
        .map((e) => `${e.message}${e.details ? ` (${e.details})` : ""}`);
      throw new Error([data.error?.message, ...nodeErrors].filter(Boolean).join("; ") || `ComfyUI rejected the job (${res.status}).`);
    }
    return data.prompt_id;
  }

  async history(promptId: string): Promise<ComfyHistoryEntry | null> {
    const h = await this.json<Record<string, ComfyHistoryEntry>>(`/history/${encodeURIComponent(promptId)}`);
    return h[promptId] ?? null;
  }

  async viewImage(ref: ComfyImageRef): Promise<Buffer> {
    const q = new URLSearchParams({ filename: ref.filename, subfolder: ref.subfolder ?? "", type: ref.type });
    const res = await fetch(this.u(`/view?${q}`), { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Couldn't download ${ref.filename} from ComfyUI.`);
    return Buffer.from(await res.arrayBuffer());
  }

  async interrupt(): Promise<void> {
    await fetch(this.u("/interrupt"), { method: "POST" });
  }

  async free(): Promise<void> {
    await fetch(this.u("/free"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    });
  }

  onProgress(fn: ProgressFn): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private ensureEvents(): void {
    if (this.ws || !this.baseUrl) return;
    const ws = new WebSocket(`${this.baseUrl.replace(/^http/, "ws")}/ws?clientId=${this.clientId}`);
    this.ws = ws;
    ws.on("message", (data, isBinary) => {
      if (isBinary) return; // preview images
      try {
        const msg = JSON.parse(data.toString()) as { type?: string; data?: { prompt_id?: string; value?: number; max?: number } };
        if (msg.type === "progress" && msg.data?.prompt_id) {
          for (const fn of this.listeners) fn({ promptId: msg.data.prompt_id, value: msg.data.value ?? 0, max: msg.data.max ?? 0 });
        }
      } catch {
        // ignore malformed events
      }
    });
    const reset = () => {
      if (this.ws === ws) this.ws = null;
    };
    ws.on("close", reset);
    ws.on("error", reset);
  }
}