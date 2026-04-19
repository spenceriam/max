// ---------------------------------------------------------------------------
// Wiki file system primitives
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, statSync, renameSync, openSync, fsyncSync, closeSync } from "fs";
import { join, dirname, relative, resolve, sep } from "path";
import { WIKI_DIR, WIKI_PAGES_DIR, WIKI_SOURCES_DIR } from "../paths.js";

const INDEX_PATH = join(WIKI_DIR, "index.md");
const LOG_PATH = join(WIKI_DIR, "log.md");

/**
 * Write a file atomically: write to a temp file in the same directory, fsync,
 * then rename over the destination. Prevents partial writes on crash and
 * gives readers an all-or-nothing view.
 */
export function writeFileAtomic(fullPath: string, content: string): void {
  mkdirSync(dirname(fullPath), { recursive: true });
  const tmp = `${fullPath}.${process.pid}.${Date.now()}.tmp`;
  const fd = openSync(tmp, "w");
  try {
    writeFileSync(fd, content, "utf-8");
    try { fsyncSync(fd); } catch { /* fsync may fail on some FSes; non-fatal */ }
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, fullPath);
}

/** Throw if the given relative path is not safely under pages/. Used by mutation tools. */
export function assertPagePath(relativePath: string): void {
  if (!relativePath || typeof relativePath !== "string") {
    throw new Error("Wiki path is required");
  }
  if (relativePath.includes("\0") || relativePath.includes("..")) {
    throw new Error(`Refused unsafe wiki path: ${relativePath}`);
  }
  if (!relativePath.startsWith("pages/")) {
    throw new Error(
      `Refused: only pages under pages/ may be modified by tools. Got: ${relativePath}`
    );
  }
  if (!relativePath.endsWith(".md")) {
    throw new Error(`Wiki page paths must end in .md: ${relativePath}`);
  }
  // resolvePath also enforces the wiki-root containment check.
  resolvePath(relativePath);
}

function getInitialIndex(): string {
  return `# Wiki Index

_Max's knowledge base. This file is maintained automatically._

Last updated: ${new Date().toISOString().slice(0, 10)}

## Pages

_(No pages yet.)_
`;
}

const INITIAL_LOG = `# Wiki Log

_Chronological record of wiki operations._

`;

/**
 * Create the wiki directory structure if it doesn't exist.
 * Returns true if the wiki was just created (first run).
 */
export function ensureWikiStructure(): boolean {
  const isNew = !existsSync(WIKI_DIR);

  mkdirSync(WIKI_PAGES_DIR, { recursive: true });
  mkdirSync(WIKI_SOURCES_DIR, { recursive: true });

  if (!existsSync(INDEX_PATH)) {
    writeFileAtomic(INDEX_PATH, getInitialIndex());
  }
  if (!existsSync(LOG_PATH)) {
    writeFileAtomic(LOG_PATH, INITIAL_LOG);
  }

  return isNew;
}

/** Read a wiki page by path relative to the wiki root. Returns undefined if not found. */
export function readPage(relativePath: string): string | undefined {
  const fullPath = resolvePath(relativePath);
  if (!existsSync(fullPath)) return undefined;
  return readFileSync(fullPath, "utf-8");
}

/** Write a wiki page atomically. Creates parent directories automatically. */
export function writePage(relativePath: string, content: string): void {
  const fullPath = resolvePath(relativePath);
  writeFileAtomic(fullPath, content);
}

/** Delete a wiki page. Returns true if the file existed and was removed. */
export function deletePage(relativePath: string): boolean {
  const fullPath = resolvePath(relativePath);
  if (!existsSync(fullPath)) return false;
  unlinkSync(fullPath);
  return true;
}

/** Check if a wiki page exists. */
export function pageExists(relativePath: string): boolean {
  return existsSync(resolvePath(relativePath));
}

/** List all .md files under pages/, returning paths relative to the wiki root. */
export function listPages(): string[] {
  if (!existsSync(WIKI_PAGES_DIR)) return [];
  return walkDir(WIKI_PAGES_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => relative(WIKI_DIR, f));
}

/** Save a raw source document (immutable). */
export function writeRawSource(name: string, content: string): void {
  const safeName = name.replace(/[^a-zA-Z0-9._/-]/g, "-").replace(/\.\.+/g, "-");
  const fullPath = resolve(WIKI_SOURCES_DIR, safeName);
  if (!fullPath.startsWith(WIKI_SOURCES_DIR + sep)) {
    throw new Error(`Source path escapes sources dir: ${name}`);
  }
  writeFileAtomic(fullPath, content);
}

/** Read a raw source document. */
export function readRawSource(name: string): string | undefined {
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const fullPath = join(WIKI_SOURCES_DIR, safeName);
  if (!existsSync(fullPath)) return undefined;
  return readFileSync(fullPath, "utf-8");
}

/** List all source files. */
export function listSources(): string[] {
  if (!existsSync(WIKI_SOURCES_DIR)) return [];
  return readdirSync(WIKI_SOURCES_DIR).filter((f) => {
    const full = join(WIKI_SOURCES_DIR, f);
    return statSync(full).isFile();
  });
}

/** Read index.md raw content. */
export function readIndexFile(): string {
  ensureWikiStructure();
  return readFileSync(INDEX_PATH, "utf-8");
}

/** Write index.md content atomically. */
export function writeIndexFile(content: string): void {
  writeFileAtomic(INDEX_PATH, content);
}

/** Read log.md raw content. */
export function readLogFile(): string {
  ensureWikiStructure();
  return readFileSync(LOG_PATH, "utf-8");
}

/** Write log.md content atomically. */
export function writeLogFile(content: string): void {
  writeFileAtomic(LOG_PATH, content);
}

/** Get the full wiki directory path (for external tools that need it). */
export function getWikiDir(): string {
  return WIKI_DIR;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolvePath(relativePath: string): string {
  let base: string;
  if (relativePath.startsWith("pages/") || relativePath.startsWith("sources/") ||
      relativePath === "index.md" || relativePath === "log.md") {
    base = WIKI_DIR;
  } else {
    base = WIKI_PAGES_DIR;
  }
  const resolved = resolve(base, relativePath);
  // Prevent path traversal outside the wiki directory
  if (!resolved.startsWith(WIKI_DIR + sep) && resolved !== WIKI_DIR) {
    throw new Error(`Path escapes wiki directory: ${relativePath}`);
  }
  return resolved;
}

function walkDir(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full));
    } else {
      results.push(full);
    }
  }
  return results;
}
