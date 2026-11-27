import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

/** JSON with every non-ASCII character escaped, so Urdu text survives any Windows code page. */
const toAsciiJson = (value: unknown) =>
  JSON.stringify(value).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

/** Offline Urdu speech through Piper. Audio is written to a temp file and deleted right after. */
export class PiperService {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private opts: { bin: string; voice: string; tmpDir: string }) {}

  status(): { available: boolean; error?: string } {
    if (!existsSync(this.opts.bin)) {
      return { available: false, error: `piper.exe wasn't found at ${this.opts.bin}. Set PIPER_BIN to its full path.` };
    }
    if (!existsSync(this.opts.voice)) {
      return { available: false, error: `The Urdu voice wasn't found at ${this.opts.voice}. Set PIPER_URDU_VOICE to its full path.` };
    }
    if (!existsSync(`${this.opts.voice}.json`)) {
      return { available: false, error: `The voice's settings file (${path.basename(this.opts.voice)}.json) must be in the same folder.` };
    }
    return { available: true };
  }

  /** Requests are queued so speech never competes with itself for the CPU. */
  synthesize(text: string): Promise<Buffer> {
    const job = this.chain.then(() => this.run(text));
    this.chain = job.catch(() => {});
    return job;
  }

  private async run(text: string): Promise<Buffer> {
    const st = this.status();
    if (!st.available) throw new Error(st.error);
    const clean = text.replace(/\s+/g, " ").trim().slice(0, 1000);
    if (!clean) throw new Error("Nothing to say.");

    await mkdir(this.opts.tmpDir, { recursive: true });
    const out = path.join(this.opts.tmpDir, `${randomUUID()}.wav`);
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(this.opts.bin, ["--model", this.opts.voice, "--json-input"], {
          windowsHide: true,
          cwd: path.dirname(this.opts.bin),
        });
        let stderr = "";
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error("Speaking took too long."));
        }, 60_000);
        child.stderr.on("data", (d) => {
          stderr += d.toString();
        });
        child.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new Error(`Piper failed (${code}). ${stderr.split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? ""}`));
        });
        child.stdin.end(`${toAsciiJson({ text: clean, output_file: out })}\n`);
      });
      return await readFile(out);
    } finally {
      await rm(out, { force: true }).catch(() => {});
    }
  }
}