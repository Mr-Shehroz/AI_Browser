import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TranscriptResult, VoiceLanguage, VoiceStatus } from "../../shared/types";
import type { AuditLog } from "../audit/auditLog";

const MAX_SECONDS = 60;

type RunError = Error & { stderr?: string; killed?: boolean };

function run(bin: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr }));
      else resolve({ stdout, stderr });
    });
  });
}

/** Local speech-to-text through whisper.cpp. Audio is written to a temp file and deleted right after. */
export class WhisperService {
  private busy = false;

  constructor(private opts: { bin: string; model: string; threads: number; tmpDir: string; audit: AuditLog }) {}

  status(): VoiceStatus {
    const binOk = existsSync(this.opts.bin);
    const modelOk = existsSync(this.opts.model);
    return {
      available: binOk && modelOk,
      bin: this.opts.bin,
      model: this.opts.model,
      error: !binOk
        ? `whisper-cli.exe wasn't found at ${this.opts.bin}. Set WHISPER_BIN to its full path.`
        : !modelOk
          ? `The speech model wasn't found at ${this.opts.model}. Set WHISPER_MODEL to its full path.`
          : undefined,
    };
  }

  async transcribe(wav: Buffer, language: VoiceLanguage): Promise<TranscriptResult> {
    const st = this.status();
    if (!st.available) throw new Error(st.error);

    if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
      throw new Error("Expected a WAV recording.");
    }
    const sampleRate = wav.readUInt32LE(24);
    const byteRate = wav.readUInt32LE(28);
    if (sampleRate !== 16000) throw new Error("The recording must be 16 kHz.");
    const audioSeconds = byteRate > 0 ? (wav.length - 44) / byteRate : 0;
    if (audioSeconds < 0.3) throw new Error("That recording was too short.");
    if (audioSeconds > MAX_SECONDS + 1) throw new Error(`Recordings can be up to ${MAX_SECONDS} seconds.`);
    if (this.busy) throw new Error("Still working on the previous recording. Try again in a moment.");

    this.busy = true;
    await mkdir(this.opts.tmpDir, { recursive: true });
    const base = path.join(this.opts.tmpDir, randomUUID());
    const started = Date.now();
    const translate = language === "ur2en";
    const lang = translate ? "ur" : language;

    try {
      await writeFile(`${base}.wav`, wav);
      const args = ["-m", this.opts.model, "-f", `${base}.wav`, "-l", lang, "-t", String(this.opts.threads), "-nt", "-otxt", "-of", base];
      if (translate) args.push("-tr");
      const { stderr } = await run(this.opts.bin, args, 120_000);

      const raw = await readFile(`${base}.txt`, "utf8").catch(() => "");
      const text = raw.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
      if (!text) throw new Error("I didn't catch any words. Try again, a little closer to the microphone.");

      const detected = /auto-detected language:\s*([a-z]{2,3})/i.exec(stderr)?.[1];
      const result: TranscriptResult = {
        text,
        language: translate ? "en" : language === "auto" ? detected ?? "unknown" : language,
        translated: translate,
        audioSeconds: Math.round(audioSeconds * 10) / 10,
        durationMs: Date.now() - started,
      };
      // Only metadata is logged; the text is audited if and when it becomes a goal or reply.
      void this.opts.audit.write("voice_transcribed", {
        language: result.language, translated: translate, chars: text.length,
        audioSeconds: result.audioSeconds, durationMs: result.durationMs,
      });
      return result;
    } catch (err) {
      const e = err as RunError;
      if (e.killed) throw new Error("Transcription took too long. Try a shorter recording, or switch to the base model.");
      if (e.stderr === undefined) throw e;
      const detail = e.stderr.split(/\r?\n/).filter(Boolean).slice(-2).join(" ");
      throw new Error(`Speech recognition failed. ${detail}`.slice(0, 300));
    } finally {
      this.busy = false;
      await rm(`${base}.wav`, { force: true }).catch(() => {});
      await rm(`${base}.txt`, { force: true }).catch(() => {});
    }
  }
}