// Pure Markdown helpers shared by the vault service and the app. They read Obsidian-style notes
// without rewriting them: front matter, inline #tags and [[wiki-links]] are parsed, never normalized.

export interface WikiLink {
  /** Raw link target without heading or alias: "Project plan" or "Work/Project plan". */
  target: string;
  heading: string | null;
  alias: string | null;
  embed: boolean;
}

export interface SplitNote {
  /** Front matter block text without its `---` fences, or null when the note has none. */
  frontmatter: string | null;
  body: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const WIKILINK = /(!?)\[\[([^\]\n]+?)\]\]/g;
const FENCED_CODE = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm;
const INLINE_CODE = /`[^`\n]*`/g;
// Obsidian tags: letters, digits, _, -, / (nesting); at least one non-digit.
const INLINE_TAG = /(^|[\s(,;])#([\p{L}\p{N}_\-/]+)/gu;

export function splitFrontmatter(text: string): SplitNote {
  const match = FRONTMATTER.exec(text);
  if (!match) return { frontmatter: null, body: text };
  return { frontmatter: match[1], body: text.slice(match[0].length) };
}

/** Reads a list-valued front matter key in any of the YAML shapes Obsidian writes. */
export function frontmatterList(frontmatter: string | null, key: string): string[] {
  if (!frontmatter) return [];
  const lines = frontmatter.split(/\r?\n/);
  const index = lines.findIndex((line) => new RegExp(`^${key}\\s*:`).test(line));
  if (index < 0) return [];
  const inline = lines[index].replace(new RegExp(`^${key}\\s*:`), "").trim();
  if (inline.length > 0) {
    const unwrapped = inline.startsWith("[") && inline.endsWith("]") ? inline.slice(1, -1) : inline;
    return unwrapped
      .split(",")
      .map(cleanScalar)
      .filter((value) => value.length > 0);
  }
  const values: string[] = [];
  for (const line of lines.slice(index + 1)) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (!item) break;
    const value = cleanScalar(item[1]);
    if (value.length > 0) values.push(value);
  }
  return values;
}

function cleanScalar(value: string): string {
  return value
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^#/, "")
    .trim();
}

function withoutCode(body: string): string {
  return body.replace(FENCED_CODE, "").replace(INLINE_CODE, "");
}

export function inlineTags(body: string): string[] {
  const tags = new Set<string>();
  for (const match of withoutCode(body).matchAll(INLINE_TAG)) {
    const tag = match[2].replace(/\/+$/, "");
    if (tag.length > 0 && !/^\d+$/.test(tag)) tags.add(tag);
  }
  return [...tags];
}

/** Front matter `tags` plus inline #tags, de-duplicated case-insensitively, in first-seen order. */
export function noteTags(text: string): string[] {
  const { frontmatter, body } = splitFrontmatter(text);
  const seen = new Map<string, string>();
  for (const tag of [...frontmatterList(frontmatter, "tags"), ...inlineTags(body)]) {
    const key = tag.toLowerCase();
    if (!seen.has(key)) seen.set(key, tag);
  }
  return [...seen.values()];
}

export function parseWikiLink(inner: string, embed: boolean): WikiLink {
  const pipe = inner.indexOf("|");
  const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : null;
  const destination = pipe >= 0 ? inner.slice(0, pipe) : inner;
  const hash = destination.search(/[#^]/);
  const target = (hash >= 0 ? destination.slice(0, hash) : destination).trim();
  const heading = hash >= 0 ? destination.slice(hash + 1).trim() || null : null;
  return { target, heading, alias: alias || null, embed };
}

export function wikiLinks(text: string): WikiLink[] {
  const links: WikiLink[] = [];
  for (const match of withoutCode(splitFrontmatter(text).body).matchAll(WIKILINK)) {
    links.push(parseWikiLink(match[2], match[1] === "!"));
  }
  return links;
}

/** "Work/Project plan.md" -> "Project plan". */
export function titleFromPath(notePath: string): string {
  const base = notePath.slice(notePath.lastIndexOf("/") + 1);
  return base.replace(/\.md$/i, "");
}

/** "Work/Project plan.md" -> "Work"; root notes return "". */
export function folderFromPath(notePath: string): string {
  const slash = notePath.lastIndexOf("/");
  return slash < 0 ? "" : notePath.slice(0, slash);
}

/**
 * Plain text for list previews: no front matter, markup characters or link brackets. A leading
 * heading that repeats the title is skipped, since the list already shows the title.
 */
export function previewText(text: string, maxLength = 160, title?: string): string {
  let body = splitFrontmatter(text).body;
  const heading = /^\s*#{1,6}\s+(.+?)\s*#*\s*(?:\r?\n|$)/.exec(body);
  if (heading && title && heading[1].trim().toLowerCase() === title.toLowerCase()) {
    body = body.slice(heading[0].length);
  }
  const plain = body
    .replace(FENCED_CODE, " ")
    .replace(WIKILINK, (_match, _embed: string, inner: string) => {
      const link = parseWikiLink(inner, false);
      return link.alias ?? link.target;
    })
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]\s+\[[ xX]\]|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*_~`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > maxLength ? `${plain.slice(0, maxLength - 1).trimEnd()}…` : plain;
}

/**
 * Prepares note text for the host Markdown renderer, which knows nothing about wiki-links.
 * Links become bold text (navigation lives in the links panel); embeds become a labelled line.
 */
export function toReadingMarkdown(text: string): string {
  return splitFrontmatter(text).body.replace(WIKILINK, (_match, embed: string, inner: string) => {
    const link = parseWikiLink(inner, embed === "!");
    const label = link.alias ?? (link.heading ? `${link.target} › ${link.heading}` : link.target);
    return link.embed ? `*[embedded: ${label}]*` : `**${label}**`;
  });
}

/** Turns a free-form title into a safe file name stem that Obsidian links can reach. */
export function sanitizeTitle(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  return cleaned.length > 0 ? cleaned.slice(0, 120) : "Untitled";
}

/** Local calendar date as YYYY-MM-DD. */
export function localDateStamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Local time as HH:MM. */
export function localTimeStamp(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * Resolves a [[link]] target the way Obsidian does: an exact vault path first, then the
 * shortest path whose file name matches, case-insensitively. Returns null when nothing matches.
 */
export function resolveLinkTarget(target: string, notePaths: Iterable<string>): string | null {
  const cleaned = target.trim().replace(/^\/+/, "");
  if (cleaned.length === 0) return null;
  const lower = (/\.md$/i.test(cleaned) ? cleaned : `${cleaned}.md`).toLowerCase();
  const qualified = cleaned.includes("/");
  let best: string | null = null;
  for (const notePath of notePaths) {
    const candidate = notePath.toLowerCase();
    if (candidate === lower) return notePath;
    const matches = qualified
      ? candidate.endsWith(`/${lower}`)
      : candidate.slice(candidate.lastIndexOf("/") + 1) === lower;
    if (matches && (best === null || notePath.length < best.length)) best = notePath;
  }
  return best;
}
