// ---------------------------------------------------------------------------
// One-time migration: SQLite memories → wiki pages
// ---------------------------------------------------------------------------

import { getDb, getState, setState } from "../store/db.js";
import { ensureWikiStructure, writePage, readPage, writeRawSource, listPages, deletePage } from "./fs.js";
import { addToIndex, removeFromIndex, parseIndex, writeIndex, type IndexEntry } from "./index-manager.js";
import { appendLog } from "./log-manager.js";

const MIGRATION_KEY = "wiki_migrated";
const REORG_KEY = "wiki_reorganized";

/** Check whether a migration is needed (wiki not yet populated from SQLite). */
export function shouldMigrate(): boolean {
  return getState(MIGRATION_KEY) !== "true";
}

/** Check whether reorganization is needed. */
export function shouldReorganize(): boolean {
  return getState(MIGRATION_KEY) === "true" && getState(REORG_KEY) !== "true";
}

/** Category → wiki page path and section name */
const CATEGORY_MAP: Record<string, { path: string; title: string; section: string }> = {
  preference: { path: "pages/preferences.md", title: "Preferences", section: "Knowledge" },
  fact:       { path: "pages/facts.md",       title: "Facts",       section: "Knowledge" },
  project:    { path: "pages/projects.md",    title: "Projects",    section: "Knowledge" },
  person:     { path: "pages/people.md",      title: "People",      section: "Knowledge" },
  routine:    { path: "pages/routines.md",     title: "Routines",    section: "Knowledge" },
};

/**
 * Migrate all existing SQLite memories into wiki pages.
 * Groups memories by category, creates one page per category.
 * Returns the number of memories migrated.
 */
export function migrateMemoriesToWiki(): number {
  ensureWikiStructure();

  const db = getDb();
  const rows = db.prepare(
    `SELECT id, category, content, source, created_at FROM memories ORDER BY category, id`
  ).all() as { id: number; category: string; content: string; source: string; created_at: string }[];

  if (rows.length === 0) {
    setState(MIGRATION_KEY, "true");
    appendLog("migrate", "No memories to migrate (empty table).");
    return 0;
  }

  // Group by category
  const grouped: Record<string, typeof rows> = {};
  for (const row of rows) {
    if (!grouped[row.category]) grouped[row.category] = [];
    grouped[row.category].push(row);
  }

  const now = new Date().toISOString().slice(0, 10);

  for (const [category, items] of Object.entries(grouped)) {
    const mapping = CATEGORY_MAP[category] || {
      path: `pages/${category}.md`,
      title: category.charAt(0).toUpperCase() + category.slice(1),
      section: "Knowledge",
    };

    // Build the page content
    const lines: string[] = [
      "---",
      `title: ${mapping.title}`,
      `tags: [${category}, migrated]`,
      `created: ${now}`,
      `updated: ${now}`,
      "---",
      "",
      `# ${mapping.title}`,
      "",
      `_Migrated from Max's memory store on ${now}._`,
      "",
    ];

    for (const item of items) {
      lines.push(`- ${item.content} _(${item.source}, ${item.created_at.slice(0, 10)})_`);
    }
    lines.push("");

    // Check if a page already exists (avoid clobbering manual content)
    const existing = readPage(mapping.path);
    // Idempotency marker: if the migration block was already appended, skip the
    // append so re-runs don't duplicate bullets.
    const MIGRATE_MARKER = `<!-- migrate:${category}:v1 -->`;
    if (existing) {
      if (existing.includes(MIGRATE_MARKER)) {
        // Already migrated; just refresh the index entry.
        const entry: IndexEntry = {
          path: mapping.path,
          title: mapping.title,
          summary: `${items.length} ${category} memories (already migrated)`,
          section: mapping.section,
        };
        addToIndex(entry);
        continue;
      }
      // Extract only the bullet-point items to append
      const bulletLines = lines.filter((l) => l.startsWith("- "));
      writePage(mapping.path, existing + `\n${MIGRATE_MARKER}\n## Migrated Memories\n\n` + bulletLines.join("\n") + "\n");
    } else {
      // Embed the marker in fresh pages too so future re-runs are no-ops.
      lines.splice(lines.length - 1, 0, MIGRATE_MARKER);
      writePage(mapping.path, lines.join("\n"));
    }

    // Update index
    const entry: IndexEntry = {
      path: mapping.path,
      title: mapping.title,
      summary: `${items.length} ${category} memories (migrated from SQLite)`,
      section: mapping.section,
    };
    addToIndex(entry);
  }

  const total = rows.length;
  const categories = Object.keys(grouped).join(", ");
  appendLog("migrate", `Migrated ${total} memories across categories: ${categories}`);

  setState(MIGRATION_KEY, "true");
  console.log(`[max] Wiki migration complete: ${total} memories → ${Object.keys(grouped).length} pages`);

  return total;
}

// ---------------------------------------------------------------------------
// One-time reorganization: flat dump pages → entity pages
// ---------------------------------------------------------------------------

// Patterns for junk content to filter out during reorg
const JUNK_PATTERNS = [
  /smoke\s*test/i,
  /re-?smoke/i,
  /final\s*smoke/i,
  /test.*memory/i,
  /testing.*remember/i,
];

function isJunk(line: string): boolean {
  return JUNK_PATTERNS.some((p) => p.test(line));
}

/** Parse bullet points from a wiki page body (stripping frontmatter). */
function extractBullets(content: string): string[] {
  const body = content.replace(/^---[\s\S]*?---\s*/, "");
  return body.split("\n")
    .filter((l) => l.trim().startsWith("- "))
    .map((l) => l.trim());
}

/** Detect entity mentions in bullet text for routing. */
function detectEntity(bullet: string, category: string): string | undefined {
  // People: look for capitalized names
  if (category === "person" || category === "people") {
    const nameMatch = bullet.match(/^-\s+(.+?)\s+(?:is|prefers|likes|works|lives|uses|—)/i);
    if (nameMatch) {
      const name = nameMatch[1].replace(/^['"]|['"]$/g, "").trim();
      if (name.length > 1 && name.length < 40 && /^[A-Z]/.test(name)) return name;
    }
  }
  // Projects: look for project names
  if (category === "project" || category === "projects") {
    const projMatch = bullet.match(/^-\s+(?:Project\s+)?(.+?)\s+(?:is|uses|runs|—)/i);
    if (projMatch) {
      const name = projMatch[1].replace(/^['"]|['"]$/g, "").trim();
      if (name.length > 1 && name.length < 40) return name;
    }
  }
  return undefined;
}

/**
 * Reorganize wiki pages from flat category dumps into entity pages.
 * Archives originals to sources/migrated-archive/, filters junk,
 * splits into entity pages where possible.
 */
export function reorganizeWiki(): number {
  ensureWikiStructure();

  const dumpPages = [
    "pages/preferences.md",
    "pages/facts.md",
    "pages/projects.md",
    "pages/people.md",
    "pages/routines.md",
    "pages/decision.md",
    "pages/task.md",
  ];

  const now = new Date().toISOString().slice(0, 10);
  let pagesCreated = 0;

  for (const pagePath of dumpPages) {
    const content = readPage(pagePath);
    if (!content) continue;

    // Archive the original
    const archiveName = `migrated-archive/${pagePath.replace("pages/", "").replace(/\//g, "-")}`;
    writeRawSource(archiveName, content);

    const category = pagePath.replace("pages/", "").replace(".md", "");
    const bullets = extractBullets(content);
    const validBullets = bullets.filter((b) => !isJunk(b));

    if (validBullets.length === 0) {
      // All junk — remove the page
      deletePage(pagePath);
      removeFromIndex(pagePath);
      appendLog("reorg", `Removed junk page: ${pagePath}`);
      continue;
    }

    // Try to split into entity pages
    const entityGroups = new Map<string, string[]>();
    const ungrouped: string[] = [];

    for (const bullet of validBullets) {
      const entity = detectEntity(bullet, category);
      if (entity) {
        const list = entityGroups.get(entity) || [];
        list.push(bullet);
        entityGroups.set(entity, list);
      } else {
        ungrouped.push(bullet);
      }
    }

    // Write entity pages
    const categoryDir = getCategoryDirForReorg(category);
    for (const [entity, entityBullets] of entityGroups) {
      const slug = entity.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const entityPath = `pages/${categoryDir}/${slug}.md`;
      const existing = readPage(entityPath);
      const REORG_MARKER = `<!-- reorg:${entity.toLowerCase()}:v1 -->`;

      if (existing) {
        if (existing.includes(REORG_MARKER)) {
          // Already reorganized into this entity page; skip duplicate append.
          continue;
        }
        // Append to existing entity page
        const updated = existing.replace(
          /^(---[\s\S]*?updated:\s*)[\d-]+/m,
          `$1${now}`
        );
        writePage(entityPath, updated.trimEnd() + `\n${REORG_MARKER}\n` + entityBullets.join("\n") + "\n");
      } else {
        const page = [
          "---",
          `title: ${entity}`,
          `tags: [${category}, migrated]`,
          `created: ${now}`,
          `updated: ${now}`,
          "related: []",
          "---",
          "",
          `# ${entity}`,
          "",
          REORG_MARKER,
          "",
          ...entityBullets,
          "",
        ].join("\n");
        writePage(entityPath, page);
        pagesCreated++;
      }

      addToIndex({
        path: entityPath,
        title: entity,
        summary: `${entityBullets.length} entries about ${entity}`,
        section: "Knowledge",
        tags: [category, "migrated"],
        updated: now,
      });
    }

    // Keep ungrouped bullets in the category page (rewritten clean)
    if (ungrouped.length > 0) {
      const title = category.charAt(0).toUpperCase() + category.slice(1);
      const page = [
        "---",
        `title: ${title}`,
        `tags: [${category}]`,
        `created: ${now}`,
        `updated: ${now}`,
        "related: []",
        "---",
        "",
        `# ${title}`,
        "",
        ...ungrouped,
        "",
      ].join("\n");
      writePage(pagePath, page);
      addToIndex({
        path: pagePath,
        title,
        summary: `${ungrouped.length} ${category} entries`,
        section: "Knowledge",
        tags: [category],
        updated: now,
      });
    } else {
      // All bullets were entity-routed, remove the dump page
      deletePage(pagePath);
      removeFromIndex(pagePath);
    }
  }

  setState(REORG_KEY, "true");
  appendLog("reorg", `Wiki reorganized: ${pagesCreated} entity pages created`);
  console.log(`[max] Wiki reorganization complete: ${pagesCreated} entity pages created`);

  return pagesCreated;
}

function getCategoryDirForReorg(category: string): string {
  const map: Record<string, string> = {
    person: "people",
    people: "people",
    project: "projects",
    projects: "projects",
    preference: "preferences",
    preferences: "preferences",
    fact: "facts",
    facts: "facts",
    routine: "routines",
    routines: "routines",
    decision: "decisions",
    task: "tasks",
  };
  return map[category] || category;
}
