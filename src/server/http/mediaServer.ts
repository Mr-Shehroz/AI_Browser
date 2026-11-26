import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

export const UPLOAD_NAME = /^up-[\w-]+\.(png|jpg|webp)$/;
const IMAGE_NAME = /^[\w-]+\.png$/;
const MAX_UPLOAD = 20 * 1024 * 1024;
const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

/** Identify by content, not by the browser-supplied type. */
function sniff(buf: Buffer): "png" | "jpg" | "webp" | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") return "png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

function send(res: ServerResponse, status: number, body: object): void {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

export function createMediaHandler(opts: { imagesDir: string; uploadsDir: string; allowedOrigins: string[] }) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const origin = req.headers.origin;
    const allowed = !!origin && opts.allowedOrigins.includes(origin);
    if (allowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    const url = new URL(req.url ?? "/", "http://localhost");

    try {
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "GET, POST");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        res.writeHead(allowed ? 204 : 403).end();
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/media/")) {
        const [, , kind, raw] = url.pathname.split("/");
        const name = decodeURIComponent(raw ?? "");
        const dir = kind === "images" ? opts.imagesDir : kind === "uploads" ? opts.uploadsDir : null;
        const valid = kind === "images" ? IMAGE_NAME.test(name) : UPLOAD_NAME.test(name);
        if (!dir || !valid) return send(res, 400, { error: "Bad file name." });
        const file = path.join(dir, name);
        if (!existsSync(file)) return send(res, 404, { error: "Not found." });
        const ext = name.split(".").pop() ?? "";
        res.writeHead(200, {
          "Content-Type": TYPES[ext] ?? "application/octet-stream",
          "Cache-Control": "private, max-age=31536000, immutable",
        });
        createReadStream(file).pipe(res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/upload") {
        if (!allowed) return send(res, 403, { error: "Origin not allowed." });
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += (chunk as Buffer).length;
          if (size > MAX_UPLOAD) return send(res, 413, { error: "Images up to 20 MB only." });
          chunks.push(chunk as Buffer);
        }
        const buf = Buffer.concat(chunks);
        const ext = sniff(buf);
        if (!ext) return send(res, 415, { error: "Use a PNG, JPEG or WebP image." });
        const uploadId = `up-${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
        await writeFile(path.join(opts.uploadsDir, uploadId), buf);
        return send(res, 200, { uploadId });
      }

      send(res, 404, { error: "Not found." });
    } catch (err) {
      send(res, 500, { error: err instanceof Error ? err.message : "Server error." });
    }
  };
}