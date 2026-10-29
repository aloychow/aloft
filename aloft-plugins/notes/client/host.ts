import type { PluginClientContext } from "@getpaseo/plugin/client";

// Screens do not receive openSettings; the entry stores this installation's client context here.
let client: PluginClientContext | null = null;

export const NOTES_SETTINGS_ID = "notes-settings";

export function setNotesClient(next: PluginClientContext | null): void {
  client = next;
}

export function openNotesSettings(): void {
  client?.openSettings(NOTES_SETTINGS_ID);
}
