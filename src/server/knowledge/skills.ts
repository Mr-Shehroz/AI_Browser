import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Skill } from "../../shared/types";
import type { AuditLog } from "../audit/auditLog";
import { listDir, readJson, writeJson } from "./util";

export type SkillDraft = Pick<
  Skill,
  | "id" | "name" | "purpose" | "domains" | "prerequisites" | "inputs" | "steps" | "verification"
  | "failureCases" | "rollback" | "risk" | "sources" | "confidence" | "derivedFromGoal"
>;

const STOP = new Set(["the", "and", "for", "with", "from", "into", "this", "that", "find", "open", "get", "use", "how", "what", "your", "page", "site"]);
const tokens = (s: string) =>
  new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t)));

function toMarkdown(s: Skill): string {
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "- None recorded");
  return [
    `# ${s.name} (v${s.version})`, "", s.purpose, "",
    `Status: ${s.status}`, `Risk: ${s.risk}`, `Confidence: ${s.confidence}`,
    `Domains: ${s.domains.join(", ") || "any"}`, `Tested: ${s.testedAt ?? "never"}`, `Approved: ${s.approvedAt ?? "no"}`, "",
    "## Inputs", list(s.inputs), "",
    "## Prerequisites", list(s.prerequisites), "",
    "## Steps", ...s.steps.map((st, i) => `${i + 1}. ${st.instruction}${st.expected ? `\n   Expected: ${st.expected}` : ""}`), "",
    "## Verification", list(s.verification), "",
    "## Known failure cases", list(s.failureCases), "",
    "## Rollback", s.rollback || "Not recorded", "",
    "## Sources", list(s.sources.map((x) => `${x.url} (read ${x.accessedAt})`)), "",
    "## History", list(s.history.map((h) => `${h.at}: v${h.version}, ${h.change}`)), "",
  ].join("\n");
}

export class SkillLibrary {
  private versions = new Map<string, Skill[]>();

  constructor(private dir: string, readonly maxAgeDays: number, private audit: AuditLog) {}

  async init(): Promise<void> {
    for (const d of await listDir(this.dir)) {
      if (!d.isDirectory()) continue;
      const files = (await listDir(path.join(this.dir, d.name))).filter((f) => /^v\d+\.json$/.test(f.name));
      const list: Skill[] = [];
      for (const f of files) {
        const s = await readJson<Skill>(path.join(this.dir, d.name, f.name));
        if (s) list.push(s);
      }
      if (list.length) this.versions.set(d.name, list.sort((a, b) => a.version - b.version));
    }
  }

  latest(id: string): Skill | undefined {
    const list = this.versions.get(id);
    return list?.[list.length - 1];
  }

  list(): Skill[] {
    return [...this.versions.keys()]
      .map((id) => this.latest(id)!)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private async persist(s: Skill): Promise<void> {
    const base = path.join(this.dir, s.id);
    await writeJson(path.join(base, `v${s.version}.json`), s);
    await writeFile(path.join(base, `v${s.version}.md`), toMarkdown(s), "utf8");
  }

  /** Every content change is a new version that starts as a draft. */
  async addVersion(draft: SkillDraft): Promise<Skill> {
    const prev = this.latest(draft.id);
    const now = new Date().toISOString();
    const version = prev ? prev.version + 1 : 1;
    const skill: Skill = {
      ...draft,
      version,
      status: "draft",
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      uses: 0,
      successes: 0,
      history: [
        ...(prev?.history ?? []),
        { version, at: now, change: prev ? `New draft superseding v${prev.version}` : "Drafted from a completed goal" },
      ],
    };
    this.versions.set(draft.id, [...(this.versions.get(draft.id) ?? []), skill]);
    await this.persist(skill);
    void this.audit.write("skill_drafted", { id: skill.id, version });
    return skill;
  }

  /** Status and bookkeeping changes update the current version in place, with a history entry. */
  async update(id: string, patch: Partial<Skill>, change: string): Promise<Skill> {
    const s = this.latest(id);
    if (!s) throw new Error("Skill not found.");
    const now = new Date().toISOString();
    Object.assign(s, patch, { updatedAt: now });
    s.history.push({ version: s.version, at: now, change });
    await this.persist(s);
    void this.audit.write("skill_updated", { id, version: s.version, change, status: s.status });
    return s;
  }

  /** True when the last test or freshness check is older than the window. */
  isDue(s: Skill): boolean {
    const ref = s.lastValidatedAt ?? s.testedAt;
    if (!ref) return true;
    return Date.now() - Date.parse(ref) > this.maxAgeDays * 86_400_000;
  }

  /** Simple keyword retrieval over name, purpose and domains. Drafts and retired skills are never used. */
  find(query: string, domains: string[], limit = 3): Skill[] {
    const q = tokens(query);
    return this.list()
      .filter((s) => s.status !== "retired" && s.status !== "draft")
      .map((s) => {
        const hay = tokens(`${s.name} ${s.purpose} ${s.domains.join(" ")}`);
        let score = 0;
        for (const t of q) if (hay.has(t)) score++;
        if (s.domains.some((d) => domains.includes(d))) score += 3;
        return { s, score };
      })
      .filter((x) => x.score >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.s);
  }
}