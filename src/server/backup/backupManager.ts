import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BackupRecord } from "../../shared/types";
import type { AuditLog } from "../audit/auditLog";
import type { PageSnapshot } from "../browser/controller";

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

async function listFiles(root: string): Promise<string[]> {
  if ((await stat(root)).isFile()) return [root];
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "backup";

const newId = () => `bk-${Date.now()}-${randomUUID().slice(0, 6)}`;

export class BackupManager {
  private records: BackupRecord[] = [];
  private indexFile: string;

  constructor(private root: string, private allowedRoots: string[], private audit: AuditLog) {
    this.indexFile = path.join(root, "index.json");
  }

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    try { this.records = JSON.parse(await readFile(this.indexFile, "utf8")); } catch { this.records = []; }
  }

  list(): BackupRecord[] {
    return [...this.records].reverse();
  }

  hasVerified(taskId: string): boolean {
    return this.records.some((r) => r.taskId === taskId && r.kind === "filesystem" && r.verified);
  }

  private isAllowed(p: string): boolean {
    return this.allowedRoots.some((r) => {
      const rel = path.relative(path.resolve(r), p);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    });
  }

  private async save(rec: BackupRecord): Promise<BackupRecord> {
    this.records.push(rec);
    await writeFile(this.indexFile, JSON.stringify(this.records, null, 2));
    await this.audit.write("backup_created", { ...rec });
    return rec;
  }

  /** Copies a local file/folder, then verifies every file by SHA-256 against the source. */
  async backupPath(taskId: string, sourcePath: string, label: string): Promise<BackupRecord> {
    const source = path.resolve(sourcePath);
    if (!this.isAllowed(source)) throw new Error(`Path is outside allowed backup roots: ${this.allowedRoots.join(", ")}`);
    if (!path.relative(path.resolve(this.root), source).startsWith("..")) throw new Error("Cannot back up the backup store into itself.");
    await stat(source); // throws if missing

    const id = newId();
    const location = path.join(this.root, taskId, `${id}-${slug(label)}`);
    const payloadRoot = path.join(location, "payload");
    const copyTarget = path.join(payloadRoot, path.basename(source));
    await mkdir(payloadRoot, { recursive: true });
    await cp(source, copyTarget, { recursive: true, errorOnExist: true, force: false });

    const entries: { path: string; size: number; sha256: string }[] = [];
    let totalBytes = 0;
    let mismatches = 0;
    for (const file of await listFiles(source)) {
      const isRoot = file === source;
      const rel = isRoot ? path.basename(source) : path.relative(source, file);
      const copied = isRoot ? copyTarget : path.join(copyTarget, rel);
      const [a, b, s] = await Promise.all([sha256File(file), sha256File(copied).catch(() => ""), stat(file)]);
      if (a !== b) mismatches++;
      totalBytes += s.size;
      entries.push({ path: rel, size: s.size, sha256: a });
    }

    const verified = entries.length > 0 && totalBytes > 0 && mismatches === 0;
    const notes = verified
      ? `Verified ${entries.length} file(s) by SHA-256.`
      : `NOT verified: ${mismatches} mismatch(es), ${entries.length} file(s), ${totalBytes} bytes.`;

    await writeFile(path.join(location, "manifest.json"), JSON.stringify({ id, taskId, source, createdAt: new Date().toISOString(), entries }, null, 2));
    await writeFile(
      path.join(location, "RESTORE.md"),
      `# Restore ${id}\n\nSource: ${source}\n\nCopy \`payload/${path.basename(source)}\` back to the source location.\nThe agent's restore button writes a separate copy next to the original and never overwrites it.\n`,
    );

    return this.save({
      id, taskId, kind: "filesystem", label, source, location,
      createdAt: new Date().toISOString(), fileCount: entries.length, totalBytes,
      verified, restorable: verified, notes,
    });
  }

  /** Evidence of a page before an action. Not a restore point for the site's data. */
  async snapshotPage(taskId: string, snap: PageSnapshot, label: string): Promise<BackupRecord> {
    const id = newId();
    const location = path.join(this.root, taskId, `${id}-${slug(label)}`);
    await mkdir(location, { recursive: true });
    await writeFile(path.join(location, "page.html"), snap.html, "utf8");
    await writeFile(path.join(location, "page.png"), snap.png);
    await writeFile(path.join(location, "meta.json"), JSON.stringify({ url: snap.url, title: snap.title }, null, 2));
    const totalBytes = Buffer.byteLength(snap.html) + snap.png.length;
    return this.save({
      id, taskId, kind: "page_snapshot", label, source: snap.url, location,
      createdAt: new Date().toISOString(), fileCount: 2, totalBytes,
      verified: totalBytes > 0, restorable: false,
      notes: "Page evidence (HTML + screenshot). Not a restore point for site data.",
    });
  }

  /** Non-destructive restore: writes `<source>.restored-<time>` and leaves the original alone. */
  async restoreCopy(backupId: string): Promise<string> {
    const rec = this.records.find((r) => r.id === backupId);
    if (!rec) throw new Error("Backup not found.");
    if (!rec.restorable) throw new Error("This backup is not restorable.");
    const copied = path.join(rec.location, "payload", path.basename(rec.source));
    const dest = `${rec.source}.restored-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await cp(copied, dest, { recursive: true, errorOnExist: true, force: false });
    await this.audit.write("backup_restored_copy", { backupId, dest });
    return dest;
  }
}