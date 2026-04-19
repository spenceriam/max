// ---------------------------------------------------------------------------
// Wiki index.md manager — parse, update, and search the page catalog
// ---------------------------------------------------------------------------

import { existsSync, statSync } from "fs";
import { join } from "path";
import { WIKI_DIR } from "../paths.js";
import { readIndexFile, writeIndexFile, listPages, readPage } from "./fs.js";

export interface IndexEntry {
  path: string;      // relative to wiki root, e.g. "pages/people/burke.md"
  title: string;
  summary: string;
  section: string;   // grouping header, e.g. "People", "Projects"
  tags?: string[];   // extracted from page frontmatter
  updated?: string;  // last updated date (YYYY-MM-DD)
}

const INDEX_PATH = join(WIKI_DIR, "index.md");

// mtime-based cache so per-message context injection doesn't re-parse on every turn.
let cache: { mtimeMs: number; size: number; entries: IndexEntry[] } | undefined;

function invalidateCache(): void {
  cache = undefined;
}

/**
 * Parse index.md into structured entries.
 * Expected format (new):
 *   ## Section Name
 *   - [Title](path) — Summary text | tags: tag1, tag2 | updated: 2026-04-17
 * Also supports legacy format without tags/updated.
 */
export function parseIndex(): IndexEntry[] {
  let mtimeMs = 0, size = 0;
  if (existsSync(INDEX_PATH)) {
    const st = statSync(INDEX_PATH);
    mtimeMs = st.mtimeMs;
    size = st.size;
    if (cache && cache.mtimeMs === mtimeMs && cache.size === size) {
      return cache.entries;
    }
  }

  const content = readIndexFile();
  const entries: IndexEntry[] = [];
  let currentSection = "Uncategorized";

  for (const line of content.split("\n")) {
    // Section headers
    const sectionMatch = line.match(/^##\s+(.+)/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }

    // Entry lines: - [Title](path) — Summary | tags: t1, t2 | updated: YYYY-MM-DD
    const entryMatch = line.match(/^-\s+\[(.+?)\]\((.+?)\)\s*[—–-]\s*(.+)/);
    if (entryMatch) {
      const rawSummary = entryMatch[3].trim();
      // Parse optional | tags: ... | updated: ... suffixes
      let summary = rawSummary;
      let tags: string[] = [];
      let updated = "";

      const tagsMatch = rawSummary.match(/\|\s*tags:\s*([^|]+)/);
      if (tagsMatch) {
        tags = tagsMatch[1].split(",").map((t) => t.trim()).filter(Boolean);
        summary = summary.replace(tagsMatch[0], "").trim();
      }
      const updatedMatch = rawSummary.match(/\|\s*updated:\s*(\S+)/);
      if (updatedMatch) {
        updated = updatedMatch[1].trim();
        summary = summary.replace(updatedMatch[0], "").trim();
      }
      // Clean trailing pipe if any
      summary = summary.replace(/\|?\s*$/, "").trim();

      entries.push({
        title: entryMatch[1].trim(),
        path: entryMatch[2].trim(),
        summary,
        section: currentSection,
        tags: tags.length > 0 ? tags : undefined,
        updated: updated || undefined,
      });
    }
  }

  // Self-heal: if index is empty/corrupted but pages exist on disk, rebuild from disk.
  if (entries.length === 0) {
    const pages = listPages();
    if (pages.length > 0) {
      const rebuilt = rebuildIndexFromPages();
      cache = { mtimeMs, size, entries: rebuilt };
      return rebuilt;
    }
  }

  cache = { mtimeMs, size, entries };
  return entries;
}

/** Parse YAML frontmatter (very simple — supports key: value and key: [a, b]). */
function parseFrontmatter(content: string): Record<string, string | string[]> {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string | string[]> = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value: string | string[] = line.slice(idx + 1).trim();
    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
    } else if (typeof value === "string") {
      value = value.replace(/^['"]|['"]$/g, "");
    }
    out[key] = value;
  }
  return out;
}

/** Build (or refresh) an IndexEntry by reading the page from disk. */
export function buildIndexEntryForPage(path: string, fallback?: Partial<IndexEntry>): IndexEntry | undefined {
  const content = readPage(path);
  if (!content) return undefined;
  const fm = parseFrontmatter(content);
  const title = (typeof fm.title === "string" && fm.title) || fallback?.title || basenameTitle(path);
  const tags = Array.isArray(fm.tags) ? fm.tags : (fallback?.tags ?? []);
  const updated = (typeof fm.updated === "string" && fm.updated) || fallback?.updated;
  // Summary heuristic: existing summary if provided, else first non-frontmatter
  // non-heading content line trimmed to 160 chars.
  let summary = fallback?.summary?.trim() || "";
  if (!summary) {
    const body = content.replace(/^---[\s\S]*?---\s*/, "");
    for (const raw of body.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      summary = line.replace(/^[-*]\s+/, "").replace(/_\(\d{4}-\d{2}-\d{2}\)_$/, "").trim();
      break;
    }
  }
  if (summary.length > 160) summary = summary.slice(0, 157) + "…";
  return {
    path,
    title,
    summary: summary || title,
    section: fallback?.section || "Knowledge",
    tags: tags.length ? tags : undefined,
    updated,
  };
}

function basenameTitle(path: string): string {
  const file = path.split("/").pop() || path;
  const base = file.replace(/\.md$/, "");
  return base.split(/[-_]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** Rebuild every index entry from on-disk pages. Preserves section if known. */
export function rebuildIndexFromPages(): IndexEntry[] {
  const pages = listPages();
  const previous = new Map<string, IndexEntry>();
  // Try to keep section assignments by re-parsing the (possibly-corrupted) index without recursion.
  try {
    const raw = readIndexFile();
    let section = "Knowledge";
    for (const line of raw.split("\n")) {
      const sm = line.match(/^##\s+(.+)/);
      if (sm) { section = sm[1].trim(); continue; }
      const em = line.match(/^-\s+\[.+?\]\((.+?)\)/);
      if (em) {
        previous.set(em[1].trim(), { path: em[1].trim(), title: "", summary: "", section });
      }
    }
  } catch { /* ignore */ }

  const entries: IndexEntry[] = [];
  for (const p of pages) {
    const entry = buildIndexEntryForPage(p, previous.get(p));
    if (entry) entries.push(entry);
  }
  // Write directly without recursion through addToIndex.
  writeIndexInternal(entries);
  invalidateCache();
  return entries;
}

/** Regenerate index.md from a list of entries, grouped by section. */
export function writeIndex(entries: IndexEntry[]): void {
  writeIndexInternal(entries);
  invalidateCache();
}

function writeIndexInternal(entries: IndexEntry[]): void {
  const sections = new Map<string, IndexEntry[]>();
  for (const entry of entries) {
    const list = sections.get(entry.section) || [];
    list.push(entry);
    sections.set(entry.section, list);
  }

  const lines: string[] = [
    "# Wiki Index",
    "",
    "_Max's knowledge base. This file is maintained automatically._",
    "",
    `Last updated: ${new Date().toISOString().slice(0, 10)}`,
    "",
  ];

  for (const [section, items] of sections) {
    lines.push(`## ${section}`, "");
    for (const item of items) {
      let line = `- [${item.title}](${item.path}) — ${item.summary}`;
      if (item.tags?.length) line += ` | tags: ${item.tags.join(", ")}`;
      if (item.updated) line += ` | updated: ${item.updated}`;
      lines.push(line);
    }
    lines.push("");
  }

  if (sections.size === 0) {
    lines.push("## Pages", "", "_(No pages yet.)_", "");
  }

  writeIndexFile(lines.join("\n"));
}

/** Add or update an entry in the index. Upserts by path. */
export function addToIndex(entry: IndexEntry): void {
  const entries = parseIndex();
  const existing = entries.findIndex((e) => e.path === entry.path);
  if (existing >= 0) {
    entries[existing] = entry;
  } else {
    entries.push(entry);
  }
  writeIndex(entries);
}

/** Remove an entry from the index by path. */
export function removeFromIndex(path: string): boolean {
  const entries = parseIndex();
  const filtered = entries.filter((e) => e.path !== path);
  if (filtered.length === entries.length) return false;
  writeIndex(filtered);
  return true;
}

/**
 * Search the index for entries matching a query.
 * Matches against title, summary, section, path, and tags using keyword overlap.
 * Boosts recently updated pages as a tiebreaker.
 *
 * - Short tokens (>=2 chars) are kept so acronyms like "AI"/"UI"/"JS" work.
 * - Single-letter tokens are dropped to avoid noise.
 * - Tag/title exact matches and prefix matches get a strong score boost.
 * - Falls back to scanning page bodies when index search returns nothing.
 */
export function searchIndex(query: string, limit = 10): IndexEntry[] {
  const entries = parseIndex();
  if (entries.length === 0) return [];

  const queryWords = new Set(
    query.toLowerCase().split(/\s+/).filter((w) => w.length >= 2)
  );

  if (queryWords.size === 0) {
    return entries.slice(0, limit);
  }

  const now = Date.now();
  const scored = entries.map((entry) => {
    const titleLc = entry.title.toLowerCase();
    const summaryLc = entry.summary.toLowerCase();
    const sectionLc = entry.section.toLowerCase();
    const pathLc = entry.path.toLowerCase();
    const tagSet = new Set((entry.tags || []).map((t) => t.toLowerCase()));

    let hits = 0;
    for (const q of queryWords) {
      // Strongest signals: exact tag or exact title
      if (tagSet.has(q)) { hits += 5; continue; }
      if (titleLc === q) { hits += 5; continue; }
      // Strong: title starts with token, or path basename equals token
      if (titleLc.startsWith(q)) { hits += 3; continue; }
      const base = pathLc.split("/").pop()?.replace(/\.md$/, "") || "";
      if (base === q) { hits += 3; continue; }
      // Medium: substring in title/summary/section
      if (titleLc.includes(q) || summaryLc.includes(q) || sectionLc.includes(q)) {
        hits += 2;
        continue;
      }
      // Weak: substring in path or any tag
      if (pathLc.includes(q)) { hits += 1; continue; }
      for (const tag of tagSet) {
        if (tag.includes(q)) { hits += 1; break; }
      }
    }

    let recencyBoost = 0;
    if (entry.updated) {
      const daysSince = (now - new Date(entry.updated).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 7) recencyBoost = 0.5;
      else if (daysSince < 30) recencyBoost = 0.2;
    }
    return { entry, score: hits + recencyBoost };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (scored.length > 0) {
    return scored.map((s) => s.entry);
  }

  // Fallback: scan page bodies (bounded to avoid O(N*size) blowup).
  const MAX_BODY_SCAN = 50;
  const bodyHits: { entry: IndexEntry; score: number }[] = [];
  for (const entry of entries.slice(0, MAX_BODY_SCAN)) {
    const body = readPage(entry.path);
    if (!body) continue;
    const bodyLc = body.toLowerCase();
    let bodyScore = 0;
    for (const q of queryWords) {
      if (bodyLc.includes(q)) bodyScore += 1;
    }
    if (bodyScore > 0) bodyHits.push({ entry, score: bodyScore });
  }
  bodyHits.sort((a, b) => b.score - a.score);
  return bodyHits.slice(0, limit).map((s) => s.entry);
}

/** Get a compact text summary of the index for injection into context. */
export function getIndexSummary(): string {
  const entries = parseIndex();
  if (entries.length === 0) return "";

  const sections = new Map<string, string[]>();
  for (const e of entries) {
    const list = sections.get(e.section) || [];
    let item = `${e.title}: ${e.summary}`;
    if (e.tags?.length) item += ` [${e.tags.join(", ")}]`;
    if (e.updated) item += ` (${e.updated})`;
    list.push(item);
    sections.set(e.section, list);
  }

  const parts: string[] = [];
  for (const [section, items] of sections) {
    parts.push(`**${section}**: ${items.join("; ")}`);
  }
  return parts.join("\n");
}
