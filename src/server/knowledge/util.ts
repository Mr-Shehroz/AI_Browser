import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await readFile(file, "utf8")) as T; } catch { return null; }
}

/** Write to a temp file, then rename, so a crash never leaves half-written JSON. */
export async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await rename(tmp, file);
}

export async function listDir(dir: string) {
  try { return await readdir(dir, { withFileTypes: true }); } catch { return []; }
}

export const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

export const safeFileName = (s: string) => s.toLowerCase().replace(/[^a-z0-9.-]/g, "_").slice(0, 120);

export function domainOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}

export function extractUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s"'<>)]+/gi) ?? [];
  return [...new Set(found.map((u) => u.replace(/[.,;:!?]+$/, "")))];
}

export function extractDomains(text: string): string[] {
  const out = new Set<string>();
  for (const u of extractUrls(text)) {
    const d = domainOf(u);
    if (d) out.add(d);
  }
  for (const m of text.matchAll(/\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/gi)) {
    out.add(m[1].toLowerCase().replace(/^www\./, ""));
  }
  return [...out];
}

export function normalizeText(t: string): string {
  return t
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Line-set similarity (0..1). Tolerates small dynamic changes better than a raw hash. */
export function similarity(a: string, b: string): number {
  const A = new Set(a.split("\n"));
  const B = new Set(b.split("\n"));
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const line of A) if (B.has(line)) inter++;
  return inter / (A.size + B.size - inter);
}