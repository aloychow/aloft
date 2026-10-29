import { createHash } from "node:crypto";
import { type FSWatcher, watch } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import {
  folderFromPath,
  localDateStamp,
  localTimeStamp,
  noteTags,
  parseWikiLink,
  previewText,
  resolveLinkTarget,
  sanitizeTitle,
  titleFromPath,
  wikiLinks,
} from "../shared/markdown";

// The vault is a plain folder of Markdown files. Aloft never rewrites a file the user did not edit:
// reads are cached in memory for listing and search, and every write is checked against the
// content hash the editor loaded, so edits from Obsidian or iCloud surface as conflicts.

export interface VaultOptions {
  dailyFolder: string;
  dailyTemplate: string;
  /** Rescan interval that catches watcher events the OS dropped. */
  rescanIntervalMs?: number;
  now?: () => Date;
}

export interface NoteSummary {
  path: string;
  title: string;
  folder: string;
  mtimeMs: number;
  size: number;
  tags: string[];
  preview: string;
}

export interface NoteDocument {
  path: string;
  title: string;
  content: string;
  hash: string;
  mtimeMs: number;
}

export type WriteResult =
  | { status: "saved"; hash: string; mtimeMs: number }
  | { status: "conflict"; current: NoteDocument }
  | { status: "missing" };

export interface SearchHit {
  path: string;
  title: string;
  folder: string;
  snippet: string;
  score: number;
}

export interface NoteLinks {
  outgoing: Array<{ target: string; label: string; path: string | null }>;
  backlinks: Array<{ path: string; title: string; snippet: string }>;
}

interface IndexedNote extends NoteSummary {
  hash: string;
  lowerTitle: string;
  lowerContent: string;
  content: string;
  linkTargets: string[];
}

export class VaultError extends Error {}

const IGNORED_DIRECTORY = (name: string) => name.startsWith(".") || name === "node_modules";
const TRASH = ".trash";

const UTF8 = new TextDecoder("utf-8", { fatal: true });

/** Reads a note as UTF-8. Other encodings are refused so a save can never corrupt their bytes. */
async function readText(absolute: string): Promise<string> {
  const bytes = await fs.readFile(absolute);
  try {
    return UTF8.decode(bytes);
  } catch {
    throw new VaultError(`${path.basename(absolute)} is not UTF-8 text, so Aloft will not edit it`);
  }
}

async function readTextIfPresent(absolute: string): Promise<string | null> {
  try {
    return await readText(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function hashContent(content: string): string {
  return createHash("sha1").update(content, "utf8").digest("hex");
}

export class NoteVault {
  readonly root: string;
  private readonly options: Required<VaultOptions>;
  private readonly notes = new Map<string, IndexedNote>();
  private readonly folders = new Set<string>();
  private watcher: FSWatcher | null = null;
  private rescanTimer: ReturnType<typeof setInterval> | null = null;
  private pending = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private revisionValue = 0;
  private realRoot: string | null = null;
  private disposed = false;

  constructor(root: string, options: VaultOptions) {
    this.root = path.resolve(root);
    this.options = {
      rescanIntervalMs: 30_000,
      now: () => new Date(),
      ...options,
    };
  }

  get revision(): number {
    return this.revisionValue;
  }

  get noteCount(): number {
    return this.notes.size;
  }

  /** Creates the vault folder with a welcome note when it is missing, then indexes it. */
  async open({ watchFiles = true }: { watchFiles?: boolean } = {}): Promise<{ created: boolean }> {
    let created = false;
    try {
      const stat = await fs.stat(this.root);
      if (!stat.isDirectory()) throw new VaultError(`${this.root} is not a folder`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await fs.mkdir(this.root, { recursive: true });
      await fs.writeFile(path.join(this.root, "Welcome.md"), WELCOME_NOTE, "utf8");
      created = true;
    }
    this.realRoot = await fs.realpath(this.root);
    await this.rescanNow();
    if (watchFiles) this.startWatching();
    return { created };
  }

  dispose(): void {
    this.disposed = true;
    this.watcher?.close();
    this.watcher = null;
    if (this.rescanTimer) clearInterval(this.rescanTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
  }

  list(): NoteSummary[] {
    return [...this.notes.values()]
      .map(summaryOf)
      .sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
  }

  folderList(): string[] {
    return [...this.folders].sort((a, b) => a.localeCompare(b));
  }

  tagCounts(): Array<{ tag: string; count: number }> {
    const counts = new Map<string, { tag: string; count: number }>();
    for (const note of this.notes.values()) {
      for (const tag of note.tags) {
        const key = tag.toLowerCase();
        const entry = counts.get(key) ?? { tag, count: 0 };
        entry.count += 1;
        counts.set(key, entry);
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  async read(notePath: string): Promise<NoteDocument> {
    const relative = this.checkNotePath(notePath);
    const absolute = this.absolute(relative);
    let content: string;
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      [content, stat] = await Promise.all([readText(absolute), fs.stat(absolute)]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.forget(relative);
        throw new VaultError(`Note not found: ${relative}`);
      }
      throw error;
    }
    this.index(relative, content, stat.mtimeMs, stat.size);
    return {
      path: relative,
      title: titleFromPath(relative),
      content,
      hash: hashContent(content),
      mtimeMs: stat.mtimeMs,
    };
  }

  /** Saves only when the file still holds the content the caller loaded, unless forced. */
  write(notePath: string, content: string, baseHash: string | null, force = false) {
    return this.serial(async (): Promise<WriteResult> => {
      const relative = this.checkNotePath(notePath);
      const absolute = await this.writablePath(relative);
      const current = await readTextIfPresent(absolute);
      if (current === null && !force) return { status: "missing" };
      if (current !== null && !force && baseHash !== null && hashContent(current) !== baseHash) {
        return { status: "conflict", current: await this.read(relative) };
      }
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await this.writeAtomic(absolute, content);
      const stat = await fs.stat(absolute);
      this.index(relative, content, stat.mtimeMs, stat.size);
      this.bump();
      return { status: "saved", hash: hashContent(content), mtimeMs: stat.mtimeMs };
    });
  }

  create(input: { title?: string; folder?: string; content?: string }) {
    return this.serial(async () => {
      const folder = this.checkFolder(input.folder ?? "");
      const stem = sanitizeTitle(input.title ?? "Untitled");
      const relative = await this.uniquePath(folder, stem);
      const absolute = await this.writablePath(relative);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, input.content ?? "", { encoding: "utf8", flag: "wx" });
      const stat = await fs.stat(absolute);
      this.index(relative, input.content ?? "", stat.mtimeMs, stat.size);
      this.bump();
      return { path: relative };
    });
  }

  createFolder(folder: string) {
    return this.serial(async () => {
      const relative = this.checkFolder(folder);
      if (relative.length === 0) throw new VaultError("Folder name is empty");
      await fs.mkdir(this.absolute(relative), { recursive: true });
      this.addFolder(relative);
      this.bump();
      return { folder: relative };
    });
  }

  /**
   * Renames or moves a note and rewrites every [[link]] that pointed at it, keeping headings
   * and aliases. Returns how many other notes changed.
   */
  rename(notePath: string, input: { title?: string; folder?: string }) {
    return this.serial(async () => {
      const from = this.checkNotePath(notePath);
      if (!this.notes.has(from)) await this.read(from);
      const folder = this.checkFolder(input.folder ?? folderFromPath(from));
      const stem = sanitizeTitle(input.title ?? titleFromPath(from));
      const desired = joinPath(folder, `${stem}.md`);
      if (desired === from) return { path: from, updatedNotes: 0 };
      const caseOnly = desired.toLowerCase() === from.toLowerCase();
      // A case-only rename keeps its name unless a different file already holds it, which only
      // happens on a case-sensitive disk.
      const to =
        caseOnly && !(await this.holdsOtherFile(desired, from))
          ? desired
          : await this.uniquePath(folder, stem);
      await this.writablePath(from);
      await this.writablePath(to);

      // Find the links that point at the note before it moves; resolution changes afterwards.
      const referrers: Array<{ note: IndexedNote; targets: Set<string> }> = [];
      for (const note of this.notes.values()) {
        if (note.path === from) continue;
        const targets = note.linkTargets.filter((target) => this.resolve(target) === from);
        if (targets.length > 0) {
          referrers.push({ note, targets: new Set(targets.map((t) => t.toLowerCase())) });
        }
      }
      await fs.mkdir(path.dirname(this.absolute(to)), { recursive: true });
      await fs.rename(this.absolute(from), this.absolute(to));
      const moved = this.notes.get(from);
      this.notes.delete(from);
      if (moved) this.index(to, moved.content, moved.mtimeMs, moved.size);

      // Plain links stay plain unless another note shares the new name; path links keep a path.
      const newTitle = titleFromPath(to);
      const newStem = to.replace(/\.md$/i, "");
      const ambiguous = [...this.notes.keys()].some(
        (other) => other !== to && titleFromPath(other).toLowerCase() === newTitle.toLowerCase(),
      );
      let updatedNotes = 0;
      for (const { note, targets } of referrers) {
        // Rewrite what is on disk now; the index can lag an edit made in another app.
        const absolute = await this.writablePath(note.path);
        const current = await readTextIfPresent(absolute).catch(() => null);
        if (current === null) continue;
        const next = rewriteLinks(current, (target) => {
          if (!targets.has(target.toLowerCase())) return null;
          return target.includes("/") || ambiguous ? newStem : newTitle;
        });
        if (next === current) continue;
        await this.writeAtomic(absolute, next);
        const stat = await fs.stat(absolute);
        this.index(note.path, next, stat.mtimeMs, stat.size);
        updatedNotes += 1;
      }
      this.bump();
      return { path: to, updatedNotes };
    });
  }

  /** Moves a note into the vault's `.trash` folder, the Obsidian convention. */
  trash(notePath: string) {
    return this.serial(async () => {
      const relative = this.checkNotePath(notePath);
      await this.writablePath(relative);
      const destination = this.absolute(joinPath(TRASH, relative));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      let target = destination;
      try {
        await fs.access(target);
        target = destination.replace(/\.md$/i, ` ${Date.now()}.md`);
      } catch {
        // Nothing in the way.
      }
      await fs.rename(this.absolute(relative), target);
      this.forget(relative);
      this.bump();
      return { trashedTo: path.relative(this.root, target).split(path.sep).join("/") };
    });
  }

  dailyPath(date = this.options.now()): string {
    return joinPath(this.checkFolder(this.options.dailyFolder), `${localDateStamp(date)}.md`);
  }

  /** Returns today's daily note, creating it from the template on first use. */
  daily(date = this.options.now()) {
    return this.serial(async () => {
      const relative = this.dailyPath(date);
      const absolute = await this.writablePath(relative);
      try {
        await fs.access(absolute);
        return { path: relative, created: false };
      } catch {
        // Create below.
      }
      const content = await this.renderTemplate(date);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      try {
        await fs.writeFile(absolute, content, { encoding: "utf8", flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          return { path: relative, created: false };
        }
        throw error;
      }
      const stat = await fs.stat(absolute);
      this.index(relative, content, stat.mtimeMs, stat.size);
      this.bump();
      return { path: relative, created: true };
    });
  }

  /** Appends text as a new paragraph; `"today"` targets the daily note. Capture lines get a time. */
  async append(target: string, text: string, { timestamp = false } = {}) {
    const relative = target === "today" ? (await this.daily()).path : this.checkNotePath(target);
    return this.serial(async () => {
      const absolute = await this.writablePath(relative);
      const current = (await readTextIfPresent(absolute)) ?? "";
      // Appended lines follow the note's own line endings.
      const eol = current.includes("\r\n") ? "\r\n" : "\n";
      const raw = timestamp ? captureEntry(text, this.options.now()) : text.trimEnd();
      const entry = raw.replace(/\r?\n/g, eol);
      const separator = current.length > 0 && !current.endsWith("\n") ? eol : "";
      const gap = current.length === 0 || timestamp ? "" : eol;
      const next = `${current}${separator}${gap}${entry}${eol}`;
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await this.writeAtomic(absolute, next);
      const stat = await fs.stat(absolute);
      this.index(relative, next, stat.mtimeMs, stat.size);
      this.bump();
      return { path: relative };
    });
  }

  /**
   * Every whitespace-separated term must match the title, path or body. `#tag` terms filter by
   * tag. Title hits outrank body hits; ties go to the most recently edited note.
   */
  search(query: string, options: { limit?: number; folder?: string; tag?: string } = {}) {
    const parsed = parseQuery(query, options.tag);
    const hits: SearchHit[] = [];
    for (const note of this.notes.values()) {
      if (options.folder !== undefined && !inFolder(note.path, options.folder)) continue;
      const hit = scoreNote(note, parsed);
      if (hit) hits.push(hit);
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, options.limit ?? 50);
  }

  links(notePath: string): NoteLinks {
    const relative = this.checkNotePath(notePath);
    const note = this.notes.get(relative);
    const outgoing: NoteLinks["outgoing"] = [];
    const seen = new Set<string>();
    if (note) {
      for (const link of wikiLinks(note.content)) {
        if (link.embed || link.target.length === 0) continue;
        const key = link.target.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        outgoing.push({
          target: link.target,
          label: link.alias ?? link.target,
          path: this.resolve(link.target),
        });
      }
    }
    const backlinks: NoteLinks["backlinks"] = [];
    for (const other of this.notes.values()) {
      if (other.path === relative) continue;
      const target = other.linkTargets.find((t) => this.resolve(t) === relative);
      if (!target) continue;
      const index = other.lowerContent.indexOf(`[[${target.toLowerCase()}`);
      backlinks.push({
        path: other.path,
        title: other.title,
        snippet: index >= 0 ? snippetAt(other.content, index) : other.preview,
      });
    }
    backlinks.sort((a, b) => a.title.localeCompare(b.title));
    return { outgoing, backlinks };
  }

  /** See resolveLinkTarget. */
  resolve(target: string): string | null {
    return resolveLinkTarget(target, this.notes.keys());
  }

  /** Re-reads every changed file; queued behind writes so a walk never undoes a fresh change. */
  rescan(): Promise<void> {
    return this.serial(() => this.rescanNow());
  }

  private async rescanNow(): Promise<void> {
    const seen = new Set<string>();
    const folders = new Set<string>();
    let changed = false;
    const walk = async (directory: string, relative: string): Promise<void> => {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
        const childAbsolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (IGNORED_DIRECTORY(entry.name)) continue;
          folders.add(childRelative);
          await walk(childAbsolute, childRelative);
        } else if (entry.isFile() && /\.md$/i.test(entry.name) && !entry.name.startsWith(".")) {
          seen.add(childRelative);
          const stat = await fs.stat(childAbsolute).catch(() => null);
          if (!stat) continue;
          const known = this.notes.get(childRelative);
          if (known && known.mtimeMs === stat.mtimeMs && known.size === stat.size) continue;
          const content = await fs.readFile(childAbsolute, "utf8").catch(() => null);
          if (content === null) continue;
          this.index(childRelative, content, stat.mtimeMs, stat.size);
          changed = true;
        }
      }
    };
    await walk(this.root, "");
    for (const notePath of this.notes.keys()) {
      if (!seen.has(notePath)) {
        this.notes.delete(notePath);
        changed = true;
      }
    }
    if (folders.size !== this.folders.size || [...folders].some((f) => !this.folders.has(f))) {
      changed = true;
    }
    this.folders.clear();
    for (const folder of folders) this.folders.add(folder);
    if (changed) this.bump();
  }

  private startWatching(): void {
    try {
      this.watcher = watch(this.root, { recursive: true }, (_event, filename) => {
        // Some platforms report changes without a file name; rescan for those too.
        this.pending.add(filename ? filename.toString() : "");
        if (this.flushTimer) clearTimeout(this.flushTimer);
        this.flushTimer = setTimeout(() => void this.flushPending(), 150);
      });
      this.watcher.on("error", () => {
        // The periodic rescan keeps the index correct without the watcher.
        this.watcher?.close();
        this.watcher = null;
      });
    } catch {
      this.watcher = null;
    }
    this.rescanTimer = setInterval(() => void this.rescan(), this.options.rescanIntervalMs);
    this.rescanTimer.unref?.();
  }

  private async flushPending(): Promise<void> {
    if (this.disposed) return;
    const names = [...this.pending];
    this.pending.clear();
    const relevant = names.some((name) => {
      const parts = name.split(path.sep);
      return !parts.some((part) => IGNORED_DIRECTORY(part));
    });
    if (relevant) await this.rescan();
  }

  private index(relative: string, content: string, mtimeMs: number, size: number): void {
    const title = titleFromPath(relative);
    const folder = folderFromPath(relative);
    if (folder) this.addFolder(folder);
    this.notes.set(relative, {
      path: relative,
      title,
      folder,
      mtimeMs,
      size,
      tags: noteTags(content),
      preview: previewText(content, 160, title),
      hash: hashContent(content),
      lowerTitle: title.toLowerCase(),
      lowerContent: content.toLowerCase(),
      content,
      linkTargets: wikiLinks(content)
        .map((link) => link.target)
        .filter((target) => target.length > 0),
    });
  }

  private addFolder(folder: string): void {
    const parts = folder.split("/");
    for (let i = 1; i <= parts.length; i += 1) this.folders.add(parts.slice(0, i).join("/"));
  }

  private forget(relative: string): void {
    if (this.notes.delete(relative)) this.bump();
  }

  private bump(): void {
    this.revisionValue += 1;
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async writeAtomic(absolute: string, content: string): Promise<void> {
    const temporary = path.join(
      path.dirname(absolute),
      `.${path.basename(absolute)}.${process.pid}.${Date.now()}.tmp`,
    );
    await fs.writeFile(temporary, content, "utf8");
    try {
      await fs.rename(temporary, absolute);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  }

  private async uniquePath(folder: string, stem: string): Promise<string> {
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      const name = attempt === 0 ? `${stem}.md` : `${stem} ${attempt}.md`;
      const candidate = joinPath(folder, name);
      const taken =
        this.notes.has(candidate) ||
        (await fs
          .access(this.absolute(candidate))
          .then(() => true)
          .catch(() => false));
      if (!taken) return candidate;
    }
    throw new VaultError(`Could not find a free name for ${stem}`);
  }

  private async renderTemplate(date: Date): Promise<string> {
    const templatePath = this.options.dailyTemplate.trim();
    if (templatePath.length === 0) return "";
    let template: string;
    try {
      template = await fs.readFile(this.absolute(this.checkNotePath(templatePath)), "utf8");
    } catch {
      return "";
    }
    return template
      .replace(/\{\{\s*date\s*\}\}/g, localDateStamp(date))
      .replace(/\{\{\s*title\s*\}\}/g, localDateStamp(date))
      .replace(/\{\{\s*time\s*\}\}/g, localTimeStamp(date));
  }

  /**
   * The real path to write for a vault path. Symlinks resolve to their target so a write keeps the
   * link, and any target outside the vault is refused.
   */
  private async writablePath(relative: string): Promise<string> {
    const absolute = this.absolute(relative);
    const realRoot = this.realRoot ?? (await fs.realpath(this.root));
    let existing = absolute;
    let rest = "";
    for (;;) {
      try {
        const real = await fs.realpath(existing);
        const resolved = rest ? path.join(real, rest) : real;
        if (resolved !== realRoot && !resolved.startsWith(realRoot + path.sep)) {
          throw new VaultError(`Path leaves the vault: ${relative}`);
        }
        return resolved;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const parent = path.dirname(existing);
        if (parent === existing) throw error;
        rest = rest ? path.join(path.basename(existing), rest) : path.basename(existing);
        existing = parent;
      }
    }
  }

  /** True when `relative` names an existing file other than `self`, compared by exact name. */
  private async holdsOtherFile(relative: string, self: string): Promise<boolean> {
    const names: string[] = await fs.readdir(path.dirname(this.absolute(relative))).catch(() => []);
    const wanted = path.basename(relative);
    return names.includes(wanted) && wanted !== path.basename(self);
  }

  private absolute(relative: string): string {
    const absolute = path.resolve(this.root, relative);
    if (absolute !== this.root && !absolute.startsWith(this.root + path.sep)) {
      throw new VaultError(`Path leaves the vault: ${relative}`);
    }
    return absolute;
  }

  private checkNotePath(notePath: string): string {
    const relative = normalizeRelative(notePath);
    if (!/\.md$/i.test(relative)) throw new VaultError(`Not a Markdown note: ${notePath}`);
    if (relative.split("/").some((part) => part.startsWith("."))) {
      throw new VaultError(`Hidden paths are not notes: ${notePath}`);
    }
    return relative;
  }

  private checkFolder(folder: string): string {
    const relative = normalizeRelative(folder);
    if (relative.split("/").some((part) => part.startsWith("."))) {
      throw new VaultError(`Hidden folders are not allowed: ${folder}`);
    }
    return relative;
  }
}

function normalizeRelative(input: string): string {
  const trimmed = input
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  if (trimmed.length === 0) return "";
  const parts = trimmed.split("/").filter((part) => part.length > 0 && part !== ".");
  if (parts.some((part) => part === "..")) throw new VaultError(`Path leaves the vault: ${input}`);
  if (path.isAbsolute(input) && !input.startsWith("/")) {
    throw new VaultError(`Absolute paths are not allowed: ${input}`);
  }
  return parts.join("/");
}

function joinPath(folder: string, name: string): string {
  return folder.length > 0 ? `${folder}/${name}` : name;
}

function inFolder(notePath: string, folder: string): boolean {
  if (folder.length === 0) return true;
  return notePath.startsWith(`${folder}/`);
}

function summaryOf(note: IndexedNote): NoteSummary {
  return {
    path: note.path,
    title: note.title,
    folder: note.folder,
    mtimeMs: note.mtimeMs,
    size: note.size,
    tags: note.tags,
    preview: note.preview,
  };
}

interface ParsedQuery {
  terms: string[];
  tags: string[];
}

/** Splits a query into lower-case words and `#tag` filters. */
function parseQuery(query: string, tag?: string): ParsedQuery {
  const terms: string[] = [];
  const tags: string[] = tag ? [tag.toLowerCase()] : [];
  for (const raw of query.trim().split(/\s+/)) {
    if (raw.length === 0) continue;
    if (raw.startsWith("#") && raw.length > 1) tags.push(raw.slice(1).toLowerCase());
    else terms.push(raw.toLowerCase());
  }
  return { terms, tags };
}

function hasTags(note: IndexedNote, tags: string[]): boolean {
  const lowerTags = note.tags.map((tag) => tag.toLowerCase());
  return tags.every((tag) => lowerTags.some((t) => t === tag || t.startsWith(`${tag}/`)));
}

/** Every term must match title, path or body. Title hits outrank body hits; recency breaks ties. */
function scoreNote(note: IndexedNote, query: ParsedQuery): SearchHit | null {
  if (!hasTags(note, query.tags)) return null;
  const lowerPath = note.path.toLowerCase();
  let score = 0;
  let firstBodyIndex = -1;
  for (const term of query.terms) {
    const inTitle = note.lowerTitle.includes(term);
    const bodyIndex = note.lowerContent.indexOf(term);
    const inPath = lowerPath.includes(term);
    if (!inTitle && bodyIndex < 0 && !inPath) return null;
    if (inTitle) score += note.lowerTitle.startsWith(term) ? 15 : 10;
    if (inPath) score += 1;
    if (bodyIndex >= 0) {
      score += Math.min(5, countOccurrences(note.lowerContent, term));
      if (firstBodyIndex < 0 || bodyIndex < firstBodyIndex) firstBodyIndex = bodyIndex;
    }
  }
  return {
    path: note.path,
    title: note.title,
    folder: note.folder,
    snippet: firstBodyIndex >= 0 ? snippetAt(note.content, firstBodyIndex) : note.preview,
    score: score + note.mtimeMs / 1e15,
  };
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index >= 0 && count < 50) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Readable text around a match: link brackets and list markup removed, as in previews. */
function snippetAt(content: string, index: number): string {
  const start = Math.max(0, content.lastIndexOf("\n", index) + 1, index - 60);
  const end = Math.min(content.length, index + 100);
  const text = previewText(content.slice(start, end), 400);
  return `${start > 0 ? "…" : ""}${text}${end < content.length ? "…" : ""}`;
}

function captureEntry(text: string, date: Date): string {
  const lines = text.trim().split(/\r?\n/);
  const [first, ...rest] = lines;
  return [`- ${localTimeStamp(date)} ${first}`, ...rest.map((line) => `  ${line}`)].join("\n");
}

const CODE_SPANS = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$|`[^`\n]*`/gm;

/** Applies `transform` to the text between fenced code blocks and inline code spans. */
function outsideCode(content: string, transform: (text: string) => string): string {
  let result = "";
  let last = 0;
  for (const match of content.matchAll(CODE_SPANS)) {
    const start = match.index ?? 0;
    result += transform(content.slice(last, start)) + match[0];
    last = start + match[0].length;
  }
  return result + transform(content.slice(last));
}

/** Replaces each [[target…]] outside code whose target `replacement` maps to a new name. */
export function rewriteLinks(
  content: string,
  replacement: (target: string) => string | null,
): string {
  return outsideCode(content, (text) => rewriteLinksIn(text, replacement));
}

function rewriteLinksIn(content: string, replacement: (target: string) => string | null): string {
  return content.replace(/(!?)\[\[([^\]\n]+?)\]\]/g, (match, embed: string, inner: string) => {
    const link = parseWikiLink(inner, embed === "!");
    const next = replacement(link.target);
    if (next === null) return match;
    const pipe = inner.indexOf("|");
    const destination = pipe >= 0 ? inner.slice(0, pipe) : inner;
    const suffixIndex = destination.search(/[#^]/);
    const suffix = suffixIndex >= 0 ? destination.slice(suffixIndex) : "";
    const alias = pipe >= 0 ? inner.slice(pipe) : "";
    return `${embed}[[${next}${suffix}${alias}]]`;
  });
}

const WELCOME_NOTE = `# Welcome to Aloft Notes

Your notes are plain Markdown files in this folder, so Obsidian and any text editor can open them.

- Press **Today** to open the daily note for today.
- Link notes by typing \`[[\` and picking a title, like [[Getting started]].
- Add tags anywhere with a hash: #ideas
- Search matches titles and text. Type \`#tag\` to filter by tag.
- Agents in Aloft can search, read, create, and append to notes.
`;
