import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { z } from "zod";
import type {
  ConflictMode, ImportPreview, ImportSkillAction, PackExportResult, PackManifest, PortableSnapshot,
  ResearchNote, SiteProfile, Skill,
} from "../../shared/types";
import type { AuditLog } from "../audit/auditLog";
import type { ResearchService } from "../knowledge/research";
import type { SiteProfiles } from "../knowledge/sites";
import type { SkillLibrary } from "../knowledge/skills";
import { listDir, readJson, safeFileName, writeJson } from "../knowledge/util";

const FORMAT = "nexforce-knowledge-pack";
const SCHEMA_VERSION = 1;
const MAX_PACK_BYTES = 50 * 1024 * 1024;
const MAX_FILE_CHARS = 5_000_000;
export const EXPORT_NAME = /^nexforce-knowledge-[\w-]+\.zip$/;

const SKILL_ID = /^[a-z0-9-]{1,60}$/;
const ALLOWED_PATHS = [
  /^global\/preferences\.json$/,
  /^skills\/[a-z0-9-]{1,60}\/v\d{1,4}\.(json|md)$/,
  /^sites\/[a-z0-9._-]{1,120}\.json$/,
  /^research\/rs-[\w-]{1,60}\.(json|txt)$/,
  /^backups-index\/index\.json$/,
];

/** Anything that looks like a credential keeps a file out of the pack. */
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(sk|rk)-[A-Za-z0-9_-]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /"(password|passwd|secret|api_?key|access_?token|refresh_?token|cookie)"\s*:\s*"[^"]{4,}"/i,
];

const ALWAYS_EXCLUDED = [
  "Browser profiles: cookies, sign-ins and sessions",
  "Audit logs",
  "Backup contents (only the backup index is included)",
  "Passwords, tokens and API keys",
];

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/** Content fingerprint used to tell a real conflict from an identical copy. */
const signature = (s: Skill) =>
  sha256(JSON.stringify([s.name, s.purpose, s.inputs, s.prerequisites, s.steps, s.verification, s.failureCases, s.rollback]));

const manifestSchema = z.object({
  format: z.literal(FORMAT),
  schemaVersion: z.number().int(),
  exportedAt: z.string(),
  appVersion: z.string(),
  counts: z.object({ skills: z.number(), skillVersions: z.number(), sites: z.number(), research: z.number() }),
  files: z.array(z.object({ path: z.string(), sha256: z.string(), bytes: z.number() })).max(20_000),
  excluded: z.array(z.string()).max(20_000),
});

const str = (n: number) => z.string().max(n);

const skillSchema = z.object({
  id: z.string().regex(SKILL_ID),
  version: z.number().int().min(1).max(9999),
  name: str(200),
  purpose: str(2000),
  domains: z.array(str(253)).max(20),
  prerequisites: z.array(str(1000)).max(50),
  inputs: z.array(str(200)).max(50),
  steps: z.array(z.object({ instruction: str(2000), expected: str(1000).optional() })).max(100),
  verification: z.array(str(1000)).max(50),
  failureCases: z.array(str(1000)).max(50),
  rollback: str(2000),
  risk: z.enum(["read_only", "reversible", "impactful", "destructive", "blocked"]),
  sources: z.array(z.object({ url: str(2048), researchId: str(100).optional(), accessedAt: str(40) })).max(50),
  status: z.enum(["draft", "tested", "approved", "stale", "retired"]),
  confidence: z.enum(["low", "medium", "high"]),
  createdAt: str(40),
  updatedAt: str(40),
  uses: z.number(),
  successes: z.number(),
  history: z.array(z.object({ version: z.number(), at: str(40), change: str(1000) })).max(1000),
}).passthrough();

const siteSchema = z.object({
  domain: z.string().regex(/^[a-z0-9.-]{1,253}$/),
  firstSeen: str(40),
  lastVisited: str(40),
  visits: z.number(),
  titles: z.array(str(500)).max(50),
  notes: z.array(str(1000)).max(500),
  pitfalls: z.array(str(1000)).max(500),
  skillIds: z.array(z.string().regex(SKILL_ID)).max(500),
});

const researchSchema = z.object({
  id: z.string().regex(/^rs-[\w-]{1,60}$/),
  url: str(2048),
  title: str(500),
  accessedAt: str(40),
  contentHash: str(128),
  relevant: z.boolean(),
  summary: str(4000),
  keyPoints: z.array(str(1000)).max(20),
  versionInfo: str(500).optional(),
  goalId: str(100).optional(),
});

interface Deps {
  skills: SkillLibrary;
  sites: SiteProfiles;
  research: ResearchService;
  audit: AuditLog;
  skillsDir: string;
  sitesDir: string;
  researchDir: string;
  backupsIndexFile: string;
  exportsDir: string;
  preferences: Record<string, unknown>;
  appVersion: string;
}

interface PendingImport {
  preview: ImportPreview;
  skills: Skill[];
  sites: SiteProfile[];
  research: { note: ResearchNote; text?: string }[];
}

export interface ImportSummary {
  skillsAdded: number;
  skillDrafts: number;
  skillsSkipped: number;
  sitesNew: number;
  sitesMerged: number;
  researchAdded: number;
}

function readme(m: PackManifest): string {
  return [
    "# NexForce knowledge pack",
    "",
    `Exported: ${m.exportedAt}`,
    `App version: ${m.appVersion}`,
    `Format: ${m.format}, schema version ${m.schemaVersion}`,
    "",
    "## Contents",
    `- Skills: ${m.counts.skills} (${m.counts.skillVersions} versions, JSON plus readable Markdown)`,
    `- Site profiles: ${m.counts.sites}`,
    `- Research notes: ${m.counts.research}`,
    "- Preferences (for reference only; not applied on import)",
    "- Backup index (metadata only)",
    "",
    "## Never included",
    ...m.excluded.map((e) => `- ${e}`),
    "",
    "## Importing",
    "Open the Knowledge page in NexForce on the other computer, choose Import a pack, review the preview, then merge.",
    "Imported skills are re-checked before their first use there. Sign in to websites again on the new computer.",
    "",
  ].join("\n");
}

export class KnowledgePack {
  private pending: PendingImport | null = null;

  constructor(private d: Deps) {}

  async snapshot(): Promise<PortableSnapshot> {
    return { exports: await this.listExports(), preview: this.pending?.preview ?? null };
  }

  private async listExports(): Promise<PackExportResult[]> {
    const out: PackExportResult[] = [];
    for (const e of await listDir(this.d.exportsDir)) {
      if (!e.isFile() || !e.name.endsWith(".zip.json")) continue;
      const r = await readJson<PackExportResult>(path.join(this.d.exportsDir, e.name));
      if (r && EXPORT_NAME.test(r.fileName) && existsSync(path.join(this.d.exportsDir, r.fileName))) out.push(r);
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Reads knowledge files straight from disk, matching only the expected names. */
  private async collect(): Promise<{ path: string; content: string }[]> {
    const out: { path: string; content: string }[] = [];

    for (const dir of await listDir(this.d.skillsDir)) {
      if (!dir.isDirectory() || !SKILL_ID.test(dir.name)) continue;
      for (const f of await listDir(path.join(this.d.skillsDir, dir.name))) {
        if (!f.isFile() || !/^v\d{1,4}\.(json|md)$/.test(f.name)) continue;
        out.push({ path: `skills/${dir.name}/${f.name}`, content: await readFile(path.join(this.d.skillsDir, dir.name, f.name), "utf8") });
      }
    }
    for (const f of await listDir(this.d.sitesDir)) {
      if (!f.isFile() || !/^[a-z0-9._-]{1,120}\.json$/.test(f.name)) continue;
      out.push({ path: `sites/${f.name}`, content: await readFile(path.join(this.d.sitesDir, f.name), "utf8") });
    }
    for (const f of await listDir(this.d.researchDir)) {
      if (!f.isFile() || !/^rs-[\w-]{1,60}\.(json|txt)$/.test(f.name)) continue;
      out.push({ path: `research/${f.name}`, content: await readFile(path.join(this.d.researchDir, f.name), "utf8") });
    }
    if (existsSync(this.d.backupsIndexFile)) {
      out.push({ path: "backups-index/index.json", content: await readFile(this.d.backupsIndexFile, "utf8") });
    }
    return out;
  }

  async exportPack(): Promise<PackExportResult> {
    const zip = new JSZip();
    const files: PackManifest["files"] = [];
    const excluded: string[] = [];
    const collected = [
      { path: "global/preferences.json", content: JSON.stringify(this.d.preferences, null, 2) },
      ...(await this.collect()),
    ];

    for (const f of collected) {
      if (SECRET_PATTERNS.some((p) => p.test(f.content))) {
        excluded.push(`${f.path}: looks like it contains a secret`);
        continue;
      }
      zip.file(f.path, f.content);
      files.push({ path: f.path, sha256: sha256(f.content), bytes: Buffer.byteLength(f.content) });
    }

    const counts = {
      skills: new Set(files.filter((f) => f.path.startsWith("skills/")).map((f) => f.path.split("/")[1])).size,
      skillVersions: files.filter((f) => /^skills\/.+\.json$/.test(f.path)).length,
      sites: files.filter((f) => f.path.startsWith("sites/")).length,
      research: files.filter((f) => /^research\/.+\.json$/.test(f.path)).length,
    };
    const createdAt = new Date().toISOString();
    const manifest: PackManifest = {
      format: FORMAT,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: createdAt,
      appVersion: this.d.appVersion,
      counts,
      files,
      excluded: [...ALWAYS_EXCLUDED, ...excluded],
    };
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    zip.file("README.md", readme(manifest));

    const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
    await mkdir(this.d.exportsDir, { recursive: true });
    const fileName = `nexforce-knowledge-${createdAt.slice(0, 19).replace(/[:T]/g, "-")}.zip`;
    await writeFile(path.join(this.d.exportsDir, fileName), buf);

    const result: PackExportResult = { fileName, bytes: buf.length, counts, excluded, createdAt };
    await writeJson(path.join(this.d.exportsDir, `${fileName}.json`), result);
    void this.d.audit.write("pack_exported", { fileName, bytes: buf.length, counts, excludedCount: excluded.length });
    return result;
  }

  /** Validates a pack and works out what would change. Nothing is written until apply(). */
  async previewImport(buf: Buffer, fileName: string): Promise<ImportPreview> {
    if (buf.length > MAX_PACK_BYTES) throw new Error("Knowledge packs can be up to 50 MB.");

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(buf);
    } catch {
      throw new Error("That file isn't a valid ZIP.");
    }
    if (Object.values(zip.files).filter((f) => !f.dir).length > 20_000) throw new Error("This pack has too many files.");

    const mf = zip.file("manifest.json");
    if (!mf) throw new Error("This isn't a NexForce knowledge pack (manifest.json is missing).");
    let manifest: PackManifest;
    try {
      const parsed = manifestSchema.safeParse(JSON.parse(await mf.async("string")));
      if (!parsed.success) throw new Error("bad manifest");
      manifest = parsed.data;
    } catch {
      throw new Error("This isn't a NexForce knowledge pack (its manifest is unreadable).");
    }
    if (manifest.schemaVersion > SCHEMA_VERSION) {
      throw new Error("This pack was made by a newer version of NexForce. Update this copy first.");
    }

    const problems: string[] = [];
    const warnings: string[] = [];
    let checksumsOk = true;
    const texts = new Map<string, string>();

    for (const f of manifest.files) {
      if (!ALLOWED_PATHS.some((r) => r.test(f.path))) {
        warnings.push(`Ignored unexpected file: ${f.path}`);
        continue;
      }
      const entry = zip.file(f.path);
      if (!entry) {
        checksumsOk = false;
        problems.push(`Missing file: ${f.path}`);
        continue;
      }
      const text = await entry.async("string");
      if (text.length > MAX_FILE_CHARS) {
        problems.push(`File too large: ${f.path}`);
        continue;
      }
      if (sha256(text) !== f.sha256) {
        checksumsOk = false;
        problems.push(`Damaged or edited file (checksum mismatch): ${f.path}`);
        continue;
      }
      texts.set(f.path, text);
    }

    const skills: Skill[] = [];
    const sites: SiteProfile[] = [];
    const research: PendingImport["research"] = [];
    let preferences: Record<string, unknown> | undefined;

    for (const [p, text] of texts) {
      try {
        if (p === "global/preferences.json") {
          preferences = z.record(z.string(), z.unknown()).parse(JSON.parse(text));
          continue;
        }
        let m = /^skills\/([a-z0-9-]+)\/v(\d+)\.json$/.exec(p);
        if (m) {
          const s = skillSchema.parse(JSON.parse(text)) as unknown as Skill;
          if (s.id !== m[1] || s.version !== Number(m[2])) throw new Error("its id or version doesn't match the file name");
          skills.push(s);
          continue;
        }
        m = /^sites\/(.+)\.json$/.exec(p);
        if (m) {
          const site = siteSchema.parse(JSON.parse(text));
          if (safeFileName(site.domain) !== m[1]) throw new Error("its domain doesn't match the file name");
          sites.push(site);
          continue;
        }
        m = /^research\/(rs-[\w-]+)\.json$/.exec(p);
        if (m) {
          const note = researchSchema.parse(JSON.parse(text));
          if (note.id !== m[1]) throw new Error("its id doesn't match the file name");
          research.push({ note, text: texts.get(`research/${note.id}.txt`) });
        }
      } catch (err) {
        warnings.push(`Skipped ${p}: ${errMsg(err)}`);
      }
    }

    const byId = new Map<string, Skill[]>();
    for (const s of skills) byId.set(s.id, [...(byId.get(s.id) ?? []), s]);
    const skillRows: ImportPreview["skills"] = [];
    for (const [id, versions] of byId) {
      const local = this.d.skills.versionsOf(id);
      let action: ImportSkillAction = local.length ? "same" : "new";
      for (const s of versions) {
        const lv = local.find((v) => v.version === s.version);
        if (!lv) {
          if (action !== "conflict") action = local.length ? "update" : "new";
        } else if (signature(lv) !== signature(s)) {
          action = "conflict";
        }
      }
      const latest = versions.reduce((a, b) => (a.version > b.version ? a : b));
      skillRows.push({ id, name: latest.name, versions: versions.map((v) => v.version).sort((a, b) => a - b), action });
    }

    const preview: ImportPreview = {
      importId: randomUUID(),
      fileName,
      exportedAt: manifest.exportedAt,
      appVersion: manifest.appVersion,
      checksumsOk,
      problems,
      warnings,
      skills: skillRows.sort((a, b) => a.name.localeCompare(b.name)),
      sites: sites.map((s) => ({ domain: s.domain, action: this.d.sites.get(s.domain) ? "merge" : "new" })),
      research: {
        new: research.filter((r) => !this.d.research.has(r.note.id)).length,
        existing: research.filter((r) => this.d.research.has(r.note.id)).length,
      },
      preferences,
    };
    this.pending = { preview, skills, sites, research };
    void this.d.audit.write("pack_import_previewed", { fileName, checksumsOk, problems: problems.length, skills: skillRows.length });
    return preview;
  }

  discard(importId: string): void {
    if (this.pending?.preview.importId === importId) this.pending = null;
  }

  async apply(importId: string, conflictMode: ConflictMode): Promise<ImportSummary> {
    const p = this.pending;
    if (!p || p.preview.importId !== importId) throw new Error("That import has expired. Upload the pack again.");
    if (p.preview.problems.length) throw new Error("This pack has problems, so it can't be imported.");

    const today = new Date().toISOString();
    const summary: ImportSummary = { skillsAdded: 0, skillDrafts: 0, skillsSkipped: 0, sitesNew: 0, sitesMerged: 0, researchAdded: 0 };

    const ordered = [...p.skills].sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version);
    for (const s of ordered) {
      const local = this.d.skills.versionsOf(s.id).find((v) => v.version === s.version);
      if (local) {
        if (signature(local) === signature(s) || conflictMode === "keep_mine") {
          summary.skillsSkipped++;
          continue;
        }
        const latest = this.d.skills.versionsOf(s.id).at(-1)!;
        const version = latest.version + 1;
        await this.d.skills.importVersion({
          ...s,
          version,
          status: "draft",
          testedAt: undefined,
          approvedAt: undefined,
          lastValidatedAt: undefined,
          importedAt: today,
          updatedAt: today,
          history: [...latest.history, { version, at: today, change: `Imported from a knowledge pack as a draft (it differed from local v${s.version})` }],
        });
        summary.skillDrafts++;
        continue;
      }
      await this.d.skills.importVersion({
        ...s,
        lastValidatedAt: undefined,
        importedAt: today,
        history: [...s.history, { version: s.version, at: today, change: "Imported from a knowledge pack; re-checked before first use" }],
      });
      summary.skillsAdded++;
    }

    for (const site of p.sites) {
      const result = await this.d.sites.merge(site);
      if (result === "new") summary.sitesNew++;
      else summary.sitesMerged++;
    }

    for (const r of p.research) {
      if (this.d.research.has(r.note.id)) continue;
      await this.d.research.importNote(r.note, r.text);
      summary.researchAdded++;
    }

    this.pending = null;
    void this.d.audit.write("pack_imported", { fileName: p.preview.fileName, conflictMode, ...summary });
    return summary;
  }
}