import { createReadStream, existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { ImportPreview } from "../../shared/types";
import { EXPORT_NAME } from "../portable/knowledgePack";

const MAX_UPLOAD = 50 * 1024 * 1024;

function send(res: ServerResponse, status: number, body: object): void {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

export function createPortableHandler(opts: {
  exportsDir: string;
  allowedOrigins: string[];
  onImport: (buf: Buffer, fileName: string) => Promise<ImportPreview>;
}) {
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
        res.setHeader("Access-Control-Allow-Methods", "GET, POST");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-File-Name");
        res.writeHead(allowed ? 204 : 403).end();
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/exports/")) {
        const name = decodeURIComponent(url.pathname.slice("/exports/".length));
        if (!EXPORT_NAME.test(name)) return send(res, 400, { error: "Bad file name." });
        const file = path.join(opts.exportsDir, name);
        if (!existsSync(file)) return send(res, 404, { error: "Not found." });
        res.writeHead(200, { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name}"` });
        createReadStream(file).pipe(res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/import") {
        if (!allowed) return send(res, 403, { error: "Origin not allowed." });
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += (chunk as Buffer).length;
          if (size > MAX_UPLOAD) return send(res, 413, { error: "Knowledge packs can be up to 50 MB." });
          chunks.push(chunk as Buffer);
        }
        const raw = req.headers["x-file-name"];
        const fileName = (typeof raw === "string" ? decodeURIComponent(raw) : "pack.zip").replace(/[^\w. -]/g, "_").slice(0, 120);
        return send(res, 200, await opts.onImport(Buffer.concat(chunks), fileName));
      }

      send(res, 404, { error: "Not found." });
    } catch (err) {
      send(res, 400, { error: err instanceof Error ? err.message : "Request failed." });
    }
  };
}