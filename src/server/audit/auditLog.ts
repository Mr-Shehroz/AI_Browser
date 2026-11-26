import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

/** Append-only JSONL audit trail, one file per day. Callers must redact secrets first. */
export class AuditLog {
  constructor(private dir: string) {}

  async write(event: string, data: Record<string, unknown>): Promise<void> {
    try {
      await mkdir(this.dir, { recursive: true });
      const ts = new Date().toISOString();
      await appendFile(path.join(this.dir, `${ts.slice(0, 10)}.jsonl`), JSON.stringify({ ts, event, ...data }) + "\n", "utf8");
    } catch (err) {
      console.error("[audit] write failed:", err);
    }
  }
}