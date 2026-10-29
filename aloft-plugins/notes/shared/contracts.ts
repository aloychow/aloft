import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const notePath = z.string().min(1);

export const noteSummarySchema = z.object({
  path: z.string(),
  title: z.string(),
  folder: z.string(),
  mtimeMs: z.number(),
  size: z.number(),
  tags: z.array(z.string()),
  preview: z.string(),
});
export type NoteSummary = z.output<typeof noteSummarySchema>;

export const noteDocumentSchema = z.object({
  path: z.string(),
  title: z.string(),
  content: z.string(),
  hash: z.string(),
  mtimeMs: z.number(),
});
export type NoteDocument = z.output<typeof noteDocumentSchema>;

/** Cheap poll target: the app refetches the index only when `revision` moves. */
export const notesStatus = defineRpc({
  name: "notes.status",
  input: z.object({}),
  output: z.object({
    revision: z.number(),
    vaultPath: z.string(),
    noteCount: z.number(),
    error: z.string().nullable(),
  }),
});

export const notesIndex = defineRpc({
  name: "notes.index",
  input: z.object({}),
  output: z.object({
    revision: z.number(),
    notes: z.array(noteSummarySchema),
    folders: z.array(z.string()),
    tags: z.array(z.object({ tag: z.string(), count: z.number() })),
    dailyPath: z.string(),
  }),
});

export const notesRead = defineRpc({
  name: "notes.read",
  input: z.object({ path: notePath }),
  output: noteDocumentSchema,
});

export const notesWrite = defineRpc({
  name: "notes.write",
  input: z.object({
    path: notePath,
    content: z.string(),
    baseHash: z.string().nullable(),
    force: z.boolean().default(false),
  }),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("saved"), hash: z.string(), mtimeMs: z.number() }),
    z.object({ status: z.literal("conflict"), current: noteDocumentSchema }),
    z.object({ status: z.literal("missing") }),
  ]),
});
export type NotesWriteResult = z.output<typeof notesWrite.output>;

export const notesCreate = defineRpc({
  name: "notes.create",
  input: z.object({
    title: z.string().optional(),
    folder: z.string().optional(),
    content: z.string().optional(),
  }),
  output: z.object({ path: z.string() }),
});

export const notesCreateFolder = defineRpc({
  name: "notes.create_folder",
  input: z.object({ folder: z.string().min(1) }),
  output: z.object({ folder: z.string() }),
});

export const notesRename = defineRpc({
  name: "notes.rename",
  input: z.object({ path: notePath, title: z.string().optional(), folder: z.string().optional() }),
  output: z.object({ path: z.string(), updatedNotes: z.number() }),
});

export const notesTrash = defineRpc({
  name: "notes.trash",
  input: z.object({ path: notePath }),
  output: z.object({ trashedTo: z.string() }),
});

export const notesDaily = defineRpc({
  name: "notes.daily",
  input: z.object({}),
  output: z.object({ path: z.string(), created: z.boolean() }),
});

export const notesAppend = defineRpc({
  name: "notes.append",
  input: z.object({
    target: z.string().min(1),
    text: z.string().min(1),
    timestamp: z.boolean().default(false),
  }),
  output: z.object({ path: z.string() }),
});

export const searchHitSchema = z.object({
  path: z.string(),
  title: z.string(),
  folder: z.string(),
  snippet: z.string(),
  score: z.number(),
});
export type SearchHit = z.output<typeof searchHitSchema>;

export const notesSearch = defineRpc({
  name: "notes.search",
  input: z.object({
    query: z.string(),
    limit: z.number().int().positive().max(200).optional(),
    folder: z.string().optional(),
    tag: z.string().optional(),
  }),
  output: z.object({ hits: z.array(searchHitSchema) }),
});

export const notesLinks = defineRpc({
  name: "notes.links",
  input: z.object({ path: notePath }),
  output: z.object({
    outgoing: z.array(
      z.object({ target: z.string(), label: z.string(), path: z.string().nullable() }),
    ),
    backlinks: z.array(z.object({ path: z.string(), title: z.string(), snippet: z.string() })),
  }),
});
export type NoteLinks = z.output<typeof notesLinks.output>;
