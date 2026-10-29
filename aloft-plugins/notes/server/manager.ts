import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_VAULT_PATH, type NotesSettingsValues } from "../shared/settings";
import { NoteVault } from "./vault";

/**
 * A daemon started with ALOFT_NOTES_DEFAULT_VAULT uses that folder in place of the default vault.
 * Tests and dev daemons set it so they never touch the real ~/Documents vault; a folder chosen in
 * settings still wins.
 */
export function vaultRoot(vaultPath: string): string {
  const override = process.env.ALOFT_NOTES_DEFAULT_VAULT;
  if (override && vaultPath === DEFAULT_VAULT_PATH) return expandHome(override);
  return expandHome(vaultPath);
}

export function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return path.resolve(input);
}

/**
 * Owns the vault for the current settings. Changing the folder, daily folder or template swaps
 * in a fresh vault; the previous one stops watching.
 */
export class VaultManager {
  private current: { key: string; vault: NoteVault; ready: Promise<unknown> } | null = null;
  private lastError: string | null = null;

  constructor(private readonly readSettings: () => Promise<NotesSettingsValues>) {}

  async settings(): Promise<NotesSettingsValues> {
    return this.readSettings();
  }

  async vault(): Promise<NoteVault> {
    const settings = await this.readSettings();
    const root = vaultRoot(settings.vaultPath);
    const key = JSON.stringify([root, settings.dailyFolder, settings.dailyTemplate]);
    if (this.current?.key !== key) {
      this.current?.vault.dispose();
      const vault = new NoteVault(root, {
        dailyFolder: settings.dailyFolder,
        dailyTemplate: settings.dailyTemplate,
      });
      this.current = { key, vault, ready: vault.open() };
    }
    const current = this.current;
    try {
      await current.ready;
      this.lastError = null;
      return current.vault;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      if (this.current === current) {
        current.vault.dispose();
        this.current = null;
      }
      throw error;
    }
  }

  /** Status never throws, so the app can show a broken vault path instead of a failed request. */
  async status() {
    const settings = await this.readSettings();
    try {
      const vault = await this.vault();
      return {
        revision: vault.revision,
        vaultPath: vault.root,
        noteCount: vault.noteCount,
        error: null,
      };
    } catch {
      return {
        revision: -1,
        vaultPath: vaultRoot(settings.vaultPath),
        noteCount: 0,
        error: this.lastError,
      };
    }
  }

  /** Indexes an existing vault ahead of first use; never creates the folder. */
  async warm(): Promise<void> {
    const settings = await this.readSettings();
    try {
      await access(vaultRoot(settings.vaultPath));
    } catch {
      return;
    }
    await this.vault().catch(() => undefined);
  }

  dispose(): void {
    this.current?.vault.dispose();
    this.current = null;
  }
}
