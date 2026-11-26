import { execFile } from "node:child_process";
import { statfs } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";
import type { GpuInfo, HardwareInfo } from "../../shared/types";
import type { ComfySystemStats } from "./comfyClient";
import { tierFor } from "./profiles";

const run = promisify(execFile);
const GB = 1024 ** 3;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** "cuda:0 NVIDIA GeForce RTX 3060 : cudaMallocAsync" → "NVIDIA GeForce RTX 3060" */
const cleanName = (n: string) => n.replace(/^\S+:\d+\s+/, "").replace(/\s*:\s*\S+$/, "").trim();

export async function detectHardware(diskPath: string, stats?: ComfySystemStats): Promise<HardwareInfo> {
  const notes: string[] = [];
  let gpus: GpuInfo[] = [];
  let source: HardwareInfo["source"] = "none";

  // ComfyUI reports what PyTorch can actually use, including AMD and Intel GPUs.
  const comfyGpus = (stats?.devices ?? []).filter((d) => d.type !== "cpu" && d.vram_total > 0);
  if (comfyGpus.length) {
    gpus = comfyGpus.map((d) => ({ name: cleanName(d.name), vramGb: round1(d.vram_total / GB), vramFreeGb: round1(d.vram_free / GB) }));
    source = "comfyui";
  } else {
    try {
      const { stdout } = await run(
        "nvidia-smi",
        ["--query-gpu=name,memory.total,memory.free", "--format=csv,noheader,nounits"],
        { timeout: 5000, windowsHide: true },
      );
      gpus = stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => {
        const [name, total, free] = line.split(",").map((s) => s.trim());
        return { name, vramGb: round1(Number(total) / 1024), vramFreeGb: round1(Number(free) / 1024) };
      });
      source = "nvidia-smi";
    } catch {
      notes.push("No NVIDIA GPU found. AMD and Intel GPUs are detected once ComfyUI is running; press Rescan after starting it.");
    }
  }

  let freeDiskGb: number | undefined;
  try {
    const s = await statfs(diskPath);
    freeDiskGb = round1((s.bavail * s.bsize) / GB);
  } catch {
    // unknown
  }

  const ramGb = round1(os.totalmem() / GB);
  const vram = Math.max(0, ...gpus.map((g) => g.vramGb));
  if (ramGb < 16) notes.push("Less than 16 GB of system memory: memory offloading will be slow, so keep to one image per job.");
  if (freeDiskGb !== undefined && freeDiskGb < 20) notes.push(`Only ${freeDiskGb} GB free on the data drive. Image models take 2–25 GB each.`);

  return {
    os: `${os.type()} ${os.release()}`,
    cpu: os.cpus()[0]?.model.trim() ?? "Unknown CPU",
    cores: os.cpus().length,
    ramGb,
    gpus,
    freeDiskGb,
    source,
    tier: tierFor(vram),
    notes,
    detectedAt: new Date().toISOString(),
  };
}