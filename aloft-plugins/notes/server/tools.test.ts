import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentToolContext, AgentToolDefinition } from "@getpaseo/plugin/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNotesTools } from "./tools";
import { NoteVault } from "./vault";

let root: string;
let vault: NoteVault;
let tools: Map<string, AgentToolDefinition>;
const context = { signal: new AbortController().signal } as AgentToolContext;

async function call(name: string, input: unknown) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool.execute(tool.input.parse(input), context);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "aloft-notes-tools-"));
  await fs.writeFile(path.join(root, "Groceries.md"), "Milk, eggs, coffee #home", "utf8");
  vault = new NoteVault(root, {
    dailyFolder: "Daily",
    dailyTemplate: "",
    now: () => new Date(2026, 9, 29, 9, 5),
  });
  await vault.open({ watchFiles: false });
  tools = new Map(createNotesTools(async () => vault).map((tool) => [tool.name, tool]));
});

afterEach(async () => {
  vault.dispose();
  await fs.rm(root, { recursive: true, force: true });
});

describe("notes agent tools", () => {
  it("registers five tools with valid names", () => {
    expect([...tools.keys()]).toEqual([
      "notes_search",
      "notes_read",
      "notes_recent",
      "notes_create",
      "notes_append",
    ]);
  });

  it("searches and reads by title", async () => {
    const search = await call("notes_search", { query: "coffee" });
    expect(search.text).toContain("Groceries.md");
    const read = await call("notes_read", { note: "groceries" });
    expect(read.text).toBe("# Groceries.md\n\nMilk, eggs, coffee #home");
  });

  it("creates a note with tags and refuses a duplicate", async () => {
    const created = await call("notes_create", {
      title: "Trip ideas",
      body: "Kyoto in spring",
      folder: "Travel",
      tags: ["travel", "#2027"],
    });
    expect(created.text).toBe("Created Travel/Trip ideas.md");
    expect(await fs.readFile(path.join(root, "Travel/Trip ideas.md"), "utf8")).toBe(
      '---\ntags: ["travel", "2027"]\n---\nKyoto in spring',
    );
    const duplicate = await call("notes_create", {
      title: "Trip ideas",
      body: "x",
      folder: "Travel",
    });
    expect(duplicate.isError).toBe(true);
  });

  it("appends to today's note with a timestamp and to a named note as a paragraph", async () => {
    await call("notes_append", { note: "today", text: "Agent finished the report" });
    expect(await fs.readFile(path.join(root, "Daily/2026-10-29.md"), "utf8")).toBe(
      "- 09:05 Agent finished the report\n",
    );
    await call("notes_append", { note: "Groceries", text: "Bread" });
    expect(await fs.readFile(path.join(root, "Groceries.md"), "utf8")).toBe(
      "Milk, eggs, coffee #home\n\nBread\n",
    );
    const missing = await call("notes_append", { note: "Nope", text: "x" });
    expect(missing.isError).toBe(true);
  });

  it("lists recently edited notes", async () => {
    const recent = await call("notes_recent", { days: 1 });
    expect(recent.text).toContain("Groceries.md");
  });
});
