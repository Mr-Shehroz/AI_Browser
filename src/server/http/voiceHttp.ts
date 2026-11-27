import type { IncomingMessage, ServerResponse } from "node:http";
import type { VoiceLanguage } from "../../shared/types";
import type { PiperService } from "../voice/piper";
import type { WhisperService } from "../voice/whisper";

const MAX_AUDIO = 4 * 1024 * 1024; // 60 s of 16 kHz mono audio is about 2 MB
const MAX_TEXT_BODY = 20 * 1024;
const LANGS: VoiceLanguage[] = ["auto", "en", "ur", "ur2en"];

function sendJson(res: ServerResponse, status: number, body: object): void {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export function createVoiceHandler(opts: { allowedOrigins: string[]; whisper: WhisperService; piper: PiperService }) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const origin = req.headers.origin;
    const allowed = !!origin && opts.allowedOrigins.includes(origin);
    if (allowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }

    try {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "POST");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        res.writeHead(allowed ? 204 : 403).end();
        return;
      }

      if (req.method === "POST" && url.pathname === "/voice/transcribe") {
        if (!allowed) return sendJson(res, 403, { error: "Origin not allowed." });
        const lang = (url.searchParams.get("lang") ?? "auto") as VoiceLanguage;
        if (!LANGS.includes(lang)) return sendJson(res, 400, { error: "Unknown language." });
        const body = await readBody(req, MAX_AUDIO);
        if (!body) return sendJson(res, 413, { error: "That recording is too long." });
        return sendJson(res, 200, await opts.whisper.transcribe(body, lang));
      }

      if (req.method === "POST" && url.pathname === "/voice/speak") {
        if (!allowed) return sendJson(res, 403, { error: "Origin not allowed." });
        const body = await readBody(req, MAX_TEXT_BODY);
        if (!body) return sendJson(res, 413, { error: "That text is too long." });
        const { text } = JSON.parse(body.toString("utf8")) as { text?: unknown };
        if (typeof text !== "string" || !text.trim()) return sendJson(res, 400, { error: "Nothing to say." });
        const wav = await opts.piper.synthesize(text);
        res.writeHead(200, { "Content-Type": "audio/wav", "Cache-Control": "no-store" }).end(wav);
        return;
      }

      sendJson(res, 404, { error: "Not found." });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : "Voice request failed." });
    }
  };
}