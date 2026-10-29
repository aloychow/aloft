import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const DEFAULT_VAULT_PATH = "~/Documents/Aloft Notes";

export const notesSettings = defineSettings({
  id: "notes",
  scope: "host",
  version: 1,
  schema: z.object({
    vaultPath: z.string().trim().min(1, "Enter a folder").default(DEFAULT_VAULT_PATH),
    dailyFolder: z.string().trim().default("Daily"),
    dailyTemplate: z.string().trim().default("Templates/Daily.md"),
    agentTools: z.boolean().default(true),
  }),
});

export type NotesSettingsValues = z.output<typeof notesSettings.schema>;
