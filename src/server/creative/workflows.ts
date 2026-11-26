/** ComfyUI "API format" graphs: node id → { class_type, inputs }. Links are [nodeId, outputIndex]. */
export type ComfyGraph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

export interface GenArgs {
  ckpt: string;
  positive: string;
  negative: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  seed: number;
  batch: number;
}

export function txt2imgGraph(a: GenArgs): ComfyGraph {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: a.ckpt } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: a.positive, clip: ["1", 1] } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: a.negative, clip: ["1", 1] } },
    "4": { class_type: "EmptyLatentImage", inputs: { width: a.width, height: a.height, batch_size: a.batch } },
    "5": {
      class_type: "KSampler",
      inputs: {
        seed: a.seed, steps: a.steps, cfg: a.cfg, sampler_name: a.sampler, scheduler: a.scheduler, denoise: 1,
        model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0],
      },
    },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": { class_type: "SaveImage", inputs: { filename_prefix: "nexforce", images: ["6", 0] } },
  };
}

/** Source image is resized to the target size first, so huge photos can't exhaust GPU memory. */
export function img2imgGraph(a: GenArgs & { image: string; denoise: number }): ComfyGraph {
  const g = txt2imgGraph(a);
  delete g["4"];
  g["8"] = { class_type: "LoadImage", inputs: { image: a.image } };
  g["9"] = { class_type: "ImageScale", inputs: { image: ["8", 0], upscale_method: "lanczos", width: a.width, height: a.height, crop: "center" } };
  g["10"] = { class_type: "VAEEncode", inputs: { pixels: ["9", 0], vae: ["1", 2] } };
  let latent: [string, number] = ["10", 0];
  if (a.batch > 1) {
    g["11"] = { class_type: "RepeatLatentBatch", inputs: { samples: ["10", 0], amount: a.batch } };
    latent = ["11", 0];
  }
  g["5"].inputs.latent_image = latent;
  g["5"].inputs.denoise = a.denoise;
  return g;
}

export function upscaleGraph(image: string, by: number, model?: string): ComfyGraph {
  const g: ComfyGraph = { "1": { class_type: "LoadImage", inputs: { image } } };
  let out: [string, number] = ["1", 0];

  if (model) {
    const m = /(?:(\d)x|x(\d))/i.exec(model);
    const factor = Number(m?.[1] ?? m?.[2] ?? 4);
    g["2"] = { class_type: "UpscaleModelLoader", inputs: { model_name: model } };
    g["3"] = { class_type: "ImageUpscaleWithModel", inputs: { upscale_model: ["2", 0], image: out } };
    out = ["3", 0];
    if (factor !== by) {
      g["4"] = { class_type: "ImageScaleBy", inputs: { image: out, upscale_method: "lanczos", scale_by: by / factor } };
      out = ["4", 0];
    }
  } else {
    g["2"] = { class_type: "ImageScaleBy", inputs: { image: out, upscale_method: "lanczos", scale_by: by } };
    out = ["2", 0];
  }

  g["9"] = { class_type: "SaveImage", inputs: { filename_prefix: "nexforce-upscale", images: out } };
  return g;
}