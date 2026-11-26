import path from "node:path";
import type { SiteProfile } from "../../shared/types";
import { domainOf, listDir, readJson, safeFileName, writeJson } from "./util";

export class SiteProfiles {
  private sites = new Map<string, SiteProfile>();

  constructor(private dir: string) {}

  async init(): Promise<void> {
    for (const e of await listDir(this.dir)) {
      if (!e.isFile() || !e.name.endsWith(".json")) continue;
      const p = await readJson<SiteProfile>(path.join(this.dir, e.name));
      if (p) this.sites.set(p.domain, p);
    }
  }

  list(): SiteProfile[] {
    return [...this.sites.values()].sort((a, b) => b.lastVisited.localeCompare(a.lastVisited));
  }

  get(domain: string): SiteProfile | undefined {
    return this.sites.get(domain);
  }

  private blank(domain: string): SiteProfile {
    const now = new Date().toISOString();
    return { domain, firstSeen: now, lastVisited: now, visits: 0, titles: [], notes: [], pitfalls: [], skillIds: [] };
  }

  private async save(p: SiteProfile): Promise<void> {
    this.sites.set(p.domain, p);
    await writeJson(path.join(this.dir, `${safeFileName(p.domain)}.json`), p);
  }

  async recordVisit(url: string, title: string): Promise<SiteProfile | null> {
    const domain = domainOf(url);
    if (!domain) return null;
    const p = this.sites.get(domain) ?? this.blank(domain);
    p.visits++;
    p.lastVisited = new Date().toISOString();
    if (title && !p.titles.includes(title)) p.titles = [title, ...p.titles].slice(0, 10);
    await this.save(p);
    return p;
  }

  async addNote(domain: string, note: string, type: "note" | "pitfall"): Promise<SiteProfile> {
    const clean = domain.toLowerCase().replace(/^www\./, "").trim();
    const p = this.sites.get(clean) ?? this.blank(clean);
    if (type === "note") p.notes.push(note.trim());
    else p.pitfalls.push(note.trim());
    await this.save(p);
    return p;
  }

  async linkSkill(domain: string, skillId: string): Promise<void> {
    const p = this.sites.get(domain) ?? this.blank(domain);
    if (!p.skillIds.includes(skillId)) p.skillIds.push(skillId);
    await this.save(p);
  }
}