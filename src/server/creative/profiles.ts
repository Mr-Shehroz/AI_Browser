import type {
  CreativeModel, HardwareInfo, HardwareTier, ImageAspect, ImageQuality, ModelFamily, StylePreset,
} from "../../shared/types";

export function tierFor(vramGb: number): HardwareTier {
  if (vramGb < 4) return "cpu";
  if (vramGb < 8) return "low";
  if (vramGb < 12) return "mid";
  if (vramGb < 24) return "high";
  return "ultra";
}

export function familyOf(fileName: string): ModelFamily {
  const n = fileName.toLowerCase();
  if (n.includes("flux")) return "flux";
  if (/sdxl|[^a-z]xl[^a-z]|xl$|xl_|pony|illustrious/.test(n)) return "sdxl";
  if (/sd15|sd_15|sd-1|sd1\.5|v1-5|1\.5|dreamshaper_8|realisticvision/.test(n)) return "sd15";
  return "unknown";
}

/** Rough GPU memory each family needs to run comfortably. */
const NEEDS_GB: Record<ModelFamily, number> = { sd15: 4, sdxl: 8, flux: 12, unknown: 6 };

export function describeModel(name: string, hw: HardwareInfo | null): CreativeModel {
  const family = familyOf(name);
  const vram = hw ? Math.max(0, ...hw.gpus.map((g) => g.vramGb)) : 0;
  const need = NEEDS_GB[family];
  const light = family === "sd15" || family === "unknown";

  let fits: CreativeModel["fits"];
  let note: string;
  if (vram >= need) {
    fits = "good";
    note = "Runs well on this machine.";
  } else if (vram >= need / 2 && vram >= 4) {
    fits = "slow";
    note = "Fits with memory offloading, so it's slower.";
  } else if (vram < 4 && light) {
    fits = "slow";
    note = "Runs on the CPU: expect minutes per image.";
  } else {
    fits = "too_big";
    note = `Needs about ${need} GB of GPU memory.`;
  }
  if (family === "unknown") note += " Model type guessed from the file name.";
  return { name, family, fits, note };
}

export function limitsFor(tier: HardwareTier): { maxBatch: number; upscaleOptions: number[] } {
  const maxBatch = { cpu: 1, low: 1, mid: 2, high: 4, ultra: 4 }[tier];
  return { maxBatch, upscaleOptions: tier === "cpu" || tier === "low" ? [2] : [2, 4] };
}

const RATIOS: Record<ImageAspect, number> = { "1:1": 1, "4:3": 4 / 3, "3:4": 3 / 4, "16:9": 16 / 9, "9:16": 9 / 16 };

/** Keeps the pixel count of base×base and snaps both sides to multiples of 64. */
export function dims(base: number, aspect: ImageAspect): { width: number; height: number } {
  const area = base * base;
  const w = Math.sqrt(area * RATIOS[aspect]);
  const snap = (x: number) => Math.max(256, Math.round(x / 64) * 64);
  return { width: snap(w), height: snap(area / w) };
}

export function settingsFor(family: ModelFamily, quality: ImageQuality, tier: HardwareTier, aspect: ImageAspect, modelName: string) {
  const name = modelName.toLowerCase();
  const small = tier === "cpu" || tier === "low";
  const q = { draft: 0, standard: 1, high: 2 }[quality];
  let base: number;
  let steps: number;
  let cfg: number;
  let sampler = "dpmpp_2m";
  let scheduler = "karras";

  switch (family) {
    case "sdxl":
      base = small ? 768 : 1024;
      steps = [15, 25, 35][q];
      cfg = 6;
      break;
    case "flux":
      base = small || tier === "mid" ? 768 : 1024;
      steps = name.includes("dev") ? [12, 20, 28][q] : [4, 4, 6][q];
      cfg = 1;
      sampler = "euler";
      scheduler = "simple";
      break;
    default:
      base = 512;
      steps = [12, 20, 30][q];
      cfg = 7;
  }

  // Few-step models: far faster, which matters most on CPU-only machines.
  if (name.includes("lcm")) {
    steps = [4, 6, 8][q];
    cfg = 1.5;
    sampler = "lcm";
    scheduler = "sgm_uniform";
  } else if (name.includes("turbo") || name.includes("lightning") || name.includes("hyper")) {
    steps = [2, 4, 6][q];
    cfg = 1.5;
    sampler = "euler_ancestral";
    scheduler = "sgm_uniform";
  } else if (tier === "cpu" && family !== "flux") {
    steps = Math.min(steps, 15);
  }

  return { ...dims(base, aspect), steps, cfg, sampler, scheduler };
}

export function recommendationFor(hw: HardwareInfo | null): string {
  switch (hw?.tier) {
    case "ultra":
      return "Plenty of GPU memory. FLUX and SDXL run at full size, with larger batches and 4× upscales.";
    case "high":
      return "SDXL at 1024px runs comfortably, and the FLUX.1 schnell fp8 checkpoint works well too.";
    case "mid":
      return "SDXL at 1024px is the sweet spot. FLUX runs at 768px with offloading, more slowly.";
    case "low":
      return "SD 1.5 models run well at 512px. SDXL works at 768px with offloading but is slow. Upscale afterwards for detail.";
    case "cpu":
      return "No usable GPU, so images render on the CPU. Use an SD 1.5 model and Draft quality; each image takes a few minutes.";
    default:
      return "Detecting this machine…";
  }
}

export const BASE_NEGATIVE = "lowres, blurry, watermark, text, jpeg artifacts, deformed";

export const PRESETS: StylePreset[] = [
  { id: "none", name: "No style", prompt: "", negative: "" },
  { id: "cinematic", name: "Cinematic still", prompt: "cinematic film still, dramatic lighting, shallow depth of field, anamorphic lens, color graded", negative: "flat lighting, oversaturated" },
  { id: "product", name: "Product photo", prompt: "studio product photography, softbox lighting, clean background, sharp focus, high detail", negative: "clutter, distorted" },
  { id: "illustration", name: "Illustration", prompt: "detailed digital illustration, clean linework, vibrant colors", negative: "photo, blurry" },
  { id: "concept", name: "Concept art", prompt: "concept art, matte painting, epic scale, atmospheric perspective", negative: "" },
];