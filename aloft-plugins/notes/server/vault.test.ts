import * as fs from "node:fs/promises";
import { symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashContent, NoteVault, rewriteLinks, VaultError } from "./vault";

const NOW = new Date(2026, 9, 29, 14, 32);
let root: string;
const vaults: NoteVault[] = [];

async function write(relative: string, content: string) {
  const absolute = path.join(root, relative);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content, "utf8");
}

async function openVault(options: { watchFiles?: boolean; dailyTemplate?: string } = {}) {
  const vault = new NoteVault(root, {
    dailyFolder: "Daily",
    dailyTemplate: options.dailyTemplate ?? "Templates/Daily.md",
    now: () => NOW,
  });
  vaults.push(vault);
  await vault.open({ watchFiles: options.watchFiles ?? false });
  return vault;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "aloft-notes-"));
});

afterEach(async () => {
  for (const vault of vaults.splice(0)) vault.dispose();
  await fs.rm(root, { recursive: true, force: true });
});

describe("opening a vault", () => {
  it("creates a missing folder with a welcome note", async () => {
    root = path.join(root, "fresh");
    const vault = await openVault();
    expect(vault.list().map((note) => note.path)).toEqual(["Welcome.md"]);
  });

  it("leaves an existing vault byte-for-byte unchanged", async () => {
    const original = "---\ntags: [a]\n---\r\n# Title\r\nBody with CRLF\r\n";
    await write("Existing.md", original);
    const before = await fs.stat(path.join(root, "Existing.md"));
    const vault = await openVault();
    const document = await vault.read("Existing.md");
    expect(document.content).toBe(original);
    expect(await fs.readdir(root)).toEqual(["Existing.md"]);
    expect((await fs.stat(path.join(root, "Existing.md"))).mtimeMs).toBe(before.mtimeMs);
  });

  it("indexes Markdown notes and skips hidden folders and other files", async () => {
    await write("A.md", "a");
    await write("Work/B.md", "b");
    await write(".obsidian/workspace.md", "x");
    await write(".trash/Old.md", "x");
    await write("Work/diagram.png", "x");
    await write(".hidden.md", "x");
    const vault = await openVault();
    expect(
      vault
        .list()
        .map((note) => note.path)
        .sort(),
    ).toEqual(["A.md", "Work/B.md"]);
    expect(vault.folderList()).toEqual(["Work"]);
  });
});

describe("saving", () => {
  it("saves when the base hash matches and reports a conflict when the file moved on", async () => {
    await write("Note.md", "one");
    const vault = await openVault();
    const loaded = await vault.read("Note.md");

    const saved = await vault.write("Note.md", "two", loaded.hash);
    expect(saved.status).toBe("saved");
    expect(await fs.readFile(path.join(root, "Note.md"), "utf8")).toBe("two");

    await write("Note.md", "changed elsewhere");
    const conflict = await vault.write("Note.md", "three", hashContent("two"));
    expect(conflict.status).toBe("conflict");
    if (conflict.status === "conflict") expect(conflict.current.content).toBe("changed elsewhere");
    expect(await fs.readFile(path.join(root, "Note.md"), "utf8")).toBe("changed elsewhere");

    const forced = await vault.write("Note.md", "three", hashContent("two"), true);
    expect(forced.status).toBe("saved");
    expect(await fs.readFile(path.join(root, "Note.md"), "utf8")).toBe("three");
  });

  it("reports a deleted note as missing unless forced", async () => {
    await write("Gone.md", "x");
    const vault = await openVault();
    const loaded = await vault.read("Gone.md");
    await fs.rm(path.join(root, "Gone.md"));
    expect((await vault.write("Gone.md", "y", loaded.hash)).status).toBe("missing");
    expect((await vault.write("Gone.md", "y", loaded.hash, true)).status).toBe("saved");
  });

  it("leaves no temporary files behind", async () => {
    await write("Note.md", "one");
    const vault = await openVault();
    await vault.write("Note.md", "two", hashContent("one"));
    expect(await fs.readdir(root)).toEqual(["Note.md"]);
  });
});

describe("creating notes", () => {
  it("picks a free, safe file name", async () => {
    const vault = await openVault();
    expect((await vault.create({})).path).toBe("Untitled.md");
    expect((await vault.create({})).path).toBe("Untitled 1.md");
    expect((await vault.create({ title: "Plan: Q4/Q1?", folder: "Work" })).path).toBe(
      "Work/Plan Q4 Q1.md",
    );
  });

  it("rejects paths outside the vault, hidden paths and non-Markdown files", async () => {
    const vault = await openVault();
    await expect(vault.read("../escape.md")).rejects.toBeInstanceOf(VaultError);
    await expect(vault.read(".obsidian/app.md")).rejects.toBeInstanceOf(VaultError);
    await expect(vault.read("image.png")).rejects.toBeInstanceOf(VaultError);
    await expect(vault.create({ folder: "../outside" })).rejects.toBeInstanceOf(VaultError);
  });
});

describe("daily notes and capture", () => {
  it("creates today's note from the template once", async () => {
    await write("Templates/Daily.md", "# {{date}}\n\nStarted at {{time}}\n");
    const vault = await openVault();
    const first = await vault.daily();
    expect(first).toEqual({ path: "Daily/2026-10-29.md", created: true });
    expect(await fs.readFile(path.join(root, first.path), "utf8")).toBe(
      "# 2026-10-29\n\nStarted at 14:32\n",
    );
    expect(await vault.daily()).toEqual({ path: "Daily/2026-10-29.md", created: false });
  });

  it("creates an empty daily note when the template is missing", async () => {
    const vault = await openVault({ dailyTemplate: "" });
    const daily = await vault.daily();
    expect(await fs.readFile(path.join(root, daily.path), "utf8")).toBe("");
  });

  it("appends timestamped capture entries to today's note", async () => {
    const vault = await openVault();
    await vault.append("today", "Call the bank", { timestamp: true });
    await vault.append("today", "Ideas\nfor the weekend", { timestamp: true });
    expect(await fs.readFile(path.join(root, "Daily/2026-10-29.md"), "utf8")).toBe(
      "- 14:32 Call the bank\n- 14:32 Ideas\n  for the weekend\n",
    );
  });

  it("appends plain text as a new paragraph", async () => {
    await write("Note.md", "First paragraph");
    const vault = await openVault();
    await vault.append("Note.md", "Second paragraph");
    expect(await fs.readFile(path.join(root, "Note.md"), "utf8")).toBe(
      "First paragraph\n\nSecond paragraph\n",
    );
  });
});

describe("search", () => {
  it("requires every term, ranks title matches first and filters by tag", async () => {
    await write("Budget 2027.md", "Spending plan #finance");
    await write("Holiday.md", "Budget for flights and hotels #travel");
    await write("Groceries.md", "Weekly list");
    const vault = await openVault();

    expect(vault.search("budget").map((hit) => hit.path)).toEqual(["Budget 2027.md", "Holiday.md"]);
    expect(vault.search("budget flights").map((hit) => hit.path)).toEqual(["Holiday.md"]);
    expect(vault.search("#finance").map((hit) => hit.path)).toEqual(["Budget 2027.md"]);
    expect(vault.search("budget #travel").map((hit) => hit.path)).toEqual(["Holiday.md"]);
    expect(vault.search("hotels")[0].snippet).toContain("hotels");
  });

  it("collects tags from front matter and inline text", async () => {
    await write("A.md", "---\ntags:\n  - Work\n  - urgent\n---\nBody #work #home");
    const vault = await openVault();
    expect(vault.list()[0].tags).toEqual(["Work", "urgent", "home"]);
    expect(vault.tagCounts()).toEqual([
      { tag: "home", count: 1 },
      { tag: "urgent", count: 1 },
      { tag: "Work", count: 1 },
    ]);
  });

  it("searches 2,000 notes in under 200 ms", async () => {
    const filler = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(60);
    await Promise.all(
      Array.from({ length: 2000 }, (_, index) =>
        write(`Bulk/Note ${index}.md`, `${filler}\nmarker${index % 50}\n`),
      ),
    );
    const vault = await openVault();
    const started = performance.now();
    const hits = vault.search("marker7 dolor");
    const elapsed = performance.now() - started;
    expect(hits.length).toBe(40);
    expect(elapsed).toBeLessThan(200);
  });
});

describe("links", () => {
  it("resolves links by name, path and case, preferring the shortest path", async () => {
    await write("Plan.md", "root plan");
    await write("Work/Plan.md", "work plan");
    await write("Work/Deep/Other.md", "x");
    const vault = await openVault();
    expect(vault.resolve("plan")).toBe("Plan.md");
    expect(vault.resolve("Work/Plan")).toBe("Work/Plan.md");
    expect(vault.resolve("other")).toBe("Work/Deep/Other.md");
    expect(vault.resolve("Missing")).toBeNull();
  });

  it("lists outgoing links and backlinks", async () => {
    await write("Hub.md", "See [[Topic]], [[Topic|again]] and [[Missing note]]. ![[diagram.png]]");
    await write("Topic.md", "Back to [[Hub#Intro]]");
    const vault = await openVault();
    expect(vault.links("Hub.md")).toEqual({
      outgoing: [
        { target: "Topic", label: "Topic", path: "Topic.md" },
        { target: "Missing note", label: "Missing note", path: null },
      ],
      backlinks: [{ path: "Topic.md", title: "Topic", snippet: "Back to Hub" }],
    });
  });

  it("rewrites links when a note is renamed, keeping headings and aliases", async () => {
    await write("Topic.md", "content");
    await write("A.md", "[[Topic]] and [[topic#Section|see this]] and [[Unrelated]]");
    await write("B.md", "![[Topic]] in a path link [[Topic.md]]");
    await write("C.md", "no links");
    const vault = await openVault();

    const result = await vault.rename("Topic.md", { title: "Subject" });
    expect(result).toEqual({ path: "Subject.md", updatedNotes: 2 });
    expect(await fs.readFile(path.join(root, "A.md"), "utf8")).toBe(
      "[[Subject]] and [[Subject#Section|see this]] and [[Unrelated]]",
    );
    expect(await fs.readFile(path.join(root, "B.md"), "utf8")).toBe(
      "![[Subject]] in a path link [[Subject]]",
    );
    expect(
      vault
        .links("Subject.md")
        .backlinks.map((link) => link.path)
        .sort(),
    ).toEqual(["A.md", "B.md"]);
  });

  it("keeps path-qualified links qualified when a note moves folder", async () => {
    await write("Work/Topic.md", "content");
    await write("A.md", "[[Work/Topic]]");
    const vault = await openVault();
    await vault.rename("Work/Topic.md", { folder: "Archive" });
    expect(await fs.readFile(path.join(root, "A.md"), "utf8")).toBe("[[Archive/Topic]]");
  });

  it("rewrites only matching link targets", () => {
    expect(rewriteLinks("[[A]] [[B|b]] [[A#h|x]]", (target) => (target === "A" ? "Z" : null))).toBe(
      "[[Z]] [[B|b]] [[Z#h|x]]",
    );
  });
});

describe("trash and outside edits", () => {
  it("moves deleted notes into .trash", async () => {
    await write("Old.md", "x");
    const vault = await openVault();
    const result = await vault.trash("Old.md");
    expect(result.trashedTo).toBe(".trash/Old.md");
    expect(vault.list()).toEqual([]);
    expect(await fs.readFile(path.join(root, ".trash/Old.md"), "utf8")).toBe("x");
  });

  it("picks up edits made by another editor on rescan", async () => {
    await write("Note.md", "one");
    const vault = await openVault();
    const revision = vault.revision;
    await write("Note.md", "two words");
    await write("New.md", "fresh");
    await vault.rescan();
    expect(vault.revision).toBeGreaterThan(revision);
    expect(vault.search("fresh").map((hit) => hit.path)).toEqual(["New.md"]);
  });

  it("notices an outside edit through the file watcher within 3 seconds", async () => {
    await write("Note.md", "one");
    const vault = await openVault({ watchFiles: true });
    const revision = vault.revision;
    await write("Watched.md", "seen by the watcher");
    await vi.waitFor(() => expect(vault.revision).toBeGreaterThan(revision), {
      timeout: 3000,
      interval: 50,
    });
    expect(vault.search("watcher").map((hit) => hit.path)).toEqual(["Watched.md"]);
  });
});

describe("data safety", () => {
  it("rewrites links from the file on disk, keeping an edit the index has not seen", async () => {
    await write("Old.md", "x");
    await write("Ref.md", "See [[Old]].");
    const vault = await openVault();
    await write("Ref.md", "See [[Old]].\nAdded in Obsidian.");
    await vault.rename("Old.md", { title: "New" });
    expect(await fs.readFile(path.join(root, "Ref.md"), "utf8")).toBe(
      "See [[New]].\nAdded in Obsidian.",
    );
  });

  it("leaves links inside code untouched when renaming", async () => {
    await write("Old.md", "x");
    await write("Ref.md", "[[Old]]\n```\nsyntax: [[Old]]\n```\nInline `[[Old]]` stays.");
    const vault = await openVault();
    await vault.rename("Old.md", { title: "New" });
    expect(await fs.readFile(path.join(root, "Ref.md"), "utf8")).toBe(
      "[[New]]\n```\nsyntax: [[Old]]\n```\nInline `[[Old]]` stays.",
    );
  });

  it("renames a note when only the letter case changes", async () => {
    await write("plan.md", "content");
    const vault = await openVault();
    const result = await vault.rename("plan.md", { title: "Plan" });
    expect(result.path).toBe("Plan.md");
    expect(await fs.readdir(root)).toEqual(["Plan.md"]);
    expect(await fs.readFile(path.join(root, "Plan.md"), "utf8")).toBe("content");
  });

  it("refuses to open or append to a note that is not UTF-8", async () => {
    await fs.writeFile(path.join(root, "Latin1.md"), Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    const vault = await openVault();
    await expect(vault.read("Latin1.md")).rejects.toThrow(/not UTF-8/);
    await expect(vault.append("Latin1.md", "more")).rejects.toThrow(/not UTF-8/);
    expect([...(await fs.readFile(path.join(root, "Latin1.md")))]).toEqual([
      0x63, 0x61, 0x66, 0xe9,
    ]);
  });

  it("refuses writes through a symlinked folder that points outside the vault", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "aloft-outside-"));
    try {
      await symlink(outside, path.join(root, "Escape"));
      const vault = await openVault();
      await expect(vault.create({ title: "Leak", folder: "Escape" })).rejects.toThrow(
        /leaves the vault/,
      );
      await expect(vault.write("Escape/Leak.md", "x", null, true)).rejects.toThrow(
        /leaves the vault/,
      );
      expect(await fs.readdir(outside)).toEqual([]);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("keeps a symlinked note a symlink when saving it", async () => {
    await write("Real/Target.md", "one");
    await symlink(path.join(root, "Real/Target.md"), path.join(root, "Alias.md"));
    const vault = await openVault();
    const loaded = await vault.read("Alias.md");
    expect((await vault.write("Alias.md", "two", loaded.hash)).status).toBe("saved");
    expect((await fs.lstat(path.join(root, "Alias.md"))).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(path.join(root, "Real/Target.md"), "utf8")).toBe("two");
  });

  it("appends with the note's own Windows line endings", async () => {
    await write("Crlf.md", "first\r\n");
    const vault = await openVault();
    await vault.append("Crlf.md", "second\nthird");
    expect(await fs.readFile(path.join(root, "Crlf.md"), "utf8")).toBe(
      "first\r\n\r\nsecond\r\nthird\r\n",
    );
  });

  it("recreates a removed note's folder when saving it again", async () => {
    await write("Gone/Note.md", "x");
    const vault = await openVault();
    await fs.rm(path.join(root, "Gone"), { recursive: true });
    expect((await vault.write("Gone/Note.md", "kept", null, true)).status).toBe("saved");
    expect(await fs.readFile(path.join(root, "Gone/Note.md"), "utf8")).toBe("kept");
  });
});
