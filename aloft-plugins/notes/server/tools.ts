import { type AgentToolDefinition, defineAgentTool } from "@getpaseo/plugin/server";
import { z } from "zod";
import { sanitizeTitle } from "../shared/markdown";
import type { NoteVault } from "./vault";

// Tools every agent in Aloft gets while "Agent tools" is on in Notes settings. They read freely
// and write only by creating new notes or appending; nothing here replaces or deletes content.

type GetVault = () => Promise<NoteVault>;

export function createNotesTools(getVault: GetVault): AgentToolDefinition[] {
  const search = defineAgentTool({
    name: "notes_search",
    title: "Search notes",
    description:
      "Search Aloysius's personal notes (Markdown vault). Every word must match the title, path or text. Add #tag to filter by tag. Returns paths for notes_read.",
    input: z.object({
      query: z.string().min(1).describe("Words to find; #tag filters by tag"),
      limit: z.number().int().positive().max(50).optional().describe("Maximum results, default 10"),
    }),
    async execute({ query, limit }) {
      const vault = await getVault();
      const hits = vault.search(query, { limit: limit ?? 10 });
      if (hits.length === 0)
        return { text: `No notes match "${query}".`, structuredContent: { hits } };
      const lines = hits.map((hit) => `- ${hit.path}: ${hit.snippet}`);
      return { text: lines.join("\n"), structuredContent: { hits } };
    },
  });

  const read = defineAgentTool({
    name: "notes_read",
    title: "Read a note",
    description:
      'Read one note in full. Pass a vault path from notes_search, a note title as written in a [[link]], or "today" for today\'s daily note.',
    input: z.object({
      note: z.string().min(1).describe('Vault path, note title, or "today"'),
    }),
    async execute({ note }) {
      const vault = await getVault();
      const notePath = note === "today" ? vault.dailyPath() : (vault.resolve(note) ?? note);
      const document = await vault.read(notePath);
      return {
        text: `# ${document.path}\n\n${document.content}`,
        structuredContent: { path: document.path, content: document.content },
      };
    },
  });

  const recent = defineAgentTool({
    name: "notes_recent",
    title: "Recently edited notes",
    description: "List notes edited in the last N days, newest first.",
    input: z.object({
      days: z.number().int().positive().max(365).optional().describe("Window in days, default 7"),
      limit: z.number().int().positive().max(100).optional().describe("Maximum notes, default 20"),
    }),
    async execute({ days, limit }) {
      const vault = await getVault();
      const since = Date.now() - (days ?? 7) * 86_400_000;
      const notes = vault
        .list()
        .filter((note) => note.mtimeMs >= since)
        .slice(0, limit ?? 20);
      const lines = notes.map(
        (note) =>
          `- ${note.path} (edited ${new Date(note.mtimeMs).toISOString()}): ${note.preview}`,
      );
      return {
        text: lines.length > 0 ? lines.join("\n") : "No notes were edited in that window.",
        structuredContent: { notes },
      };
    },
  });

  const create = defineAgentTool({
    name: "notes_create",
    title: "Create a note",
    description:
      "Create a new Markdown note. Fails if a note with that title already exists in the folder; use notes_append to add to an existing note.",
    input: z.object({
      title: z.string().min(1).describe("Note title; becomes the file name"),
      body: z.string().describe("Markdown body"),
      folder: z.string().optional().describe("Vault folder, for example Work/Projects"),
      tags: z.array(z.string()).optional().describe("Tags without the #"),
    }),
    async execute({ title, body, folder, tags }) {
      const vault = await getVault();
      const stem = sanitizeTitle(title);
      const cleanFolder = (folder ?? "")
        .replace(/\\/g, "/")
        .split("/")
        .filter((part) => part.length > 0 && part !== ".")
        .join("/");
      const expected = cleanFolder ? `${cleanFolder}/${stem}.md` : `${stem}.md`;
      if (vault.list().some((note) => note.path.toLowerCase() === expected.toLowerCase())) {
        return { isError: true, text: `A note already exists at ${expected}. Use notes_append.` };
      }
      const frontmatter =
        tags && tags.length > 0
          ? `---\ntags: [${tags.map((t) => JSON.stringify(t.replace(/^#/, ""))).join(", ")}]\n---\n`
          : "";
      const created = await vault.create({
        title,
        folder: cleanFolder,
        content: `${frontmatter}${body}`,
      });
      return { text: `Created ${created.path}`, structuredContent: created };
    },
  });

  const append = defineAgentTool({
    name: "notes_append",
    title: "Append to a note",
    description:
      'Append text to the end of an existing note. Use "today" to add a timestamped entry to today\'s daily note, creating it if needed.',
    input: z.object({
      note: z.string().min(1).describe('Vault path, note title, or "today"'),
      text: z.string().min(1).describe("Markdown to append"),
    }),
    async execute({ note, text }) {
      const vault = await getVault();
      if (note === "today") {
        const result = await vault.append("today", text, { timestamp: true });
        return { text: `Appended to ${result.path}`, structuredContent: result };
      }
      const notePath = vault.resolve(note);
      if (!notePath) return { isError: true, text: `No note named ${note}. Use notes_create.` };
      const result = await vault.append(notePath, text);
      return { text: `Appended to ${result.path}`, structuredContent: result };
    },
  });

  return [search, read, recent, create, append];
}
