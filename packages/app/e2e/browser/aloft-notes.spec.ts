import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { openCommandCenter } from "../support/helpers/command-center";
import { gotoWorkspace } from "../support/helpers/launcher";
import { connectNewWorkspaceDaemonClient } from "../support/helpers/new-workspace";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";

// Aloft Notes end to end: the plugin in aloft-plugins/notes against a real daemon and browser.
// Run with ALOFT_NOTES_DEFAULT_VAULT set to an empty scratch folder; the daemon inherits it, so
// the test never touches a real vault. ALOFT_QA_DIR keeps screenshots of each state.

const PLUGIN_DIR = path.resolve(__dirname, "../../../../aloft-plugins/notes");
const VAULT = process.env.ALOFT_NOTES_DEFAULT_VAULT ?? "";
const WIDE = { width: 1440, height: 900 };
const COMPACT = { width: 390, height: 844 };
const MOD = process.platform === "darwin" ? "Meta" : "Control";

const OBSIDIAN_NOTE =
  "---\r\ntags: [reading]\r\naliases: [Deep Work]\r\n---\r\n# Deep Work\r\n\r\nFocus blocks of 90 minutes.\r\n";

function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

async function seedVault() {
  await rm(VAULT, { recursive: true, force: true });
  const files: Record<string, string> = {
    "Projects/Aloft roadmap.md":
      "# Aloft roadmap\n\nShip [[Calendar plan]] after notes. #aloft #planning\n\n- [x] Send shortcut\n- [ ] Notes MVP\n",
    "Calendar plan.md":
      "Two-way sync with Outlook and Google.\n\nSee [[Aloft roadmap]] for order. #aloft\n",
    "Recipes/Laksa.md": "# Laksa\n\nCoconut milk, rice noodles, prawns, tau pok.\n",
    "Books/Deep Work.md": OBSIDIAN_NOTE,
    "Templates/Daily.md": "# {{date}}\n\n## Plan\n\n- [ ] \n\n## Log\n",
  };
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(VAULT, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content, "utf8");
  }
}

async function shot(page: Page, name: string, area?: Locator) {
  const directory = process.env.ALOFT_QA_DIR;
  if (!directory) return;
  await page.waitForTimeout(500);
  await page.addStyleTag({ content: ".__expo_fast_refresh { display: none !important; }" });
  const file = path.join(directory, `${name}.png`);
  if (area) await area.screenshot({ path: file });
  else await page.screenshot({ path: file });
}

function visible(page: Page, testID: string): Locator {
  return page.locator(`[data-testid="${testID}"]:visible`).first();
}

function editor(page: Page): Locator {
  // Opening Notes from the Command Center pushes a screen; the one below stays mounted, hidden.
  return page.locator('[data-testid="notes-editor"]:visible .cm-content').first();
}

async function vaultFile(relative: string): Promise<string> {
  return readFile(path.join(VAULT, relative), "utf8");
}

/** Poll targets, built outside the test body to keep callbacks shallow. */
function fileText(relative: string): () => Promise<string> {
  return () => vaultFile(relative);
}

function folderEntries(relative = ""): () => Promise<string[]> {
  return () => readdir(path.join(VAULT, relative)).catch(() => []);
}

async function openNote(page: Page, relative: string) {
  await visible(page, `notes-row-${relative}`).click();
  await expect(visible(page, "notes-view")).toBeVisible();
  await expect(visible(page, "notes-save-state")).toContainText("Saved");
}

test.describe("Aloft Notes", () => {
  test.describe.configure({ timeout: 300_000, mode: "serial" });
  let cleanup: () => Promise<void> = async () => {};
  let workspaceId = "";

  test.beforeAll(async () => {
    expect(VAULT, "set ALOFT_NOTES_DEFAULT_VAULT to a scratch folder").not.toBe("");
    await seedVault();
    const workspace = await seedWorkspace({ repoPrefix: "aloft-notes-" });
    workspaceId = workspace.workspaceId;
    const client = await connectNewWorkspaceDaemonClient({ ownProjects: false });
    const config = await client.getDaemonConfig();
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(PLUGIN_DIR);
    cleanup = async () => {
      await client.removePlugin("notes");
      await client.patchDaemonConfig({ pluginsEnabled: config.config.pluginsEnabled });
      await client.close();
      await workspace.cleanup();
    };
  });

  test.afterAll(async () => {
    await cleanup();
  });

  test("browse, edit, link, search and capture on desktop", async ({ page }) => {
    await page.setViewportSize(WIDE);
    await gotoWorkspace(page, workspaceId);
    const row = visible(page, "plugin-sidebar-notes-notes");
    await expect(row).toBeVisible({ timeout: 60_000 });
    await row.click();
    await expect(visible(page, "notes-screen")).toBeVisible({ timeout: 60_000 });

    await test.step("three panes list every note, folder and tag", async () => {
      await expect(visible(page, "notes-scope-all")).toContainText("5");
      await expect(visible(page, "notes-folder-Projects")).toBeVisible();
      await expect(visible(page, "notes-tag-aloft")).toContainText("2");
      await expect(visible(page, "notes-empty")).toBeVisible();
      await shot(page, "01-desktop-overview");
    });

    await test.step("an untouched Obsidian note keeps its bytes", async () => {
      const before = await stat(path.join(VAULT, "Books/Deep Work.md"));
      await openNote(page, "Books/Deep Work.md");
      await expect(editor(page)).toContainText("Focus blocks of 90 minutes.");
      await page.waitForTimeout(1200);
      expect(await vaultFile("Books/Deep Work.md")).toBe(OBSIDIAN_NOTE);
      expect((await stat(path.join(VAULT, "Books/Deep Work.md"))).mtimeMs).toBe(before.mtimeMs);
      await shot(page, "02-desktop-frontmatter-note");
    });

    await test.step("typing saves to disk and [[ suggests note titles", async () => {
      await openNote(page, "Projects/Aloft roadmap.md");
      await editor(page).click();
      await page.keyboard.press(`${MOD}+End`);
      await page.keyboard.type("\nNext: [[Lak");
      const option = page.locator(".cm-tooltip-autocomplete li", { hasText: "Laksa" });
      await expect(option).toBeVisible();
      await shot(page, "03-desktop-link-autocomplete");
      await page.keyboard.press("Enter");
      await page.keyboard.type(" for the team lunch");
      await expect
        .poll(fileText("Projects/Aloft roadmap.md"), { timeout: 10_000 })
        .toContain("Next: [[Laksa]] for the team lunch");
      await expect(visible(page, "notes-save-state")).toContainText("Saved");
      await shot(page, "04-desktop-editing");
    });

    await test.step("task boxes render as checkboxes and a click ticks the file", async () => {
      const line = page.locator(".cm-line:visible", { hasText: "Notes MVP" }).first();
      const box = line.locator(".cm-task-box");
      await expect(box).toHaveAttribute("aria-checked", "false");
      await box.click();
      await expect
        .poll(fileText("Projects/Aloft roadmap.md"), { timeout: 10_000 })
        .toContain("- [x] Notes MVP");
      await expect(line.locator(".cm-task-box")).toHaveAttribute("aria-checked", "true");
    });

    await test.step("Cmd-click follows a link; the target lists the backlink", async () => {
      const link = page.locator(".cm-wikilink:visible", { hasText: "Calendar plan" }).first();
      await link.click({ modifiers: [MOD] });
      await expect(visible(page, "notes-title")).toHaveValue("Calendar plan");
      await visible(page, "notes-mode-read").click();
      await expect(visible(page, "notes-reader")).toContainText(
        "Two-way sync with Outlook and Google.",
      );
      await expect(visible(page, "notes-backlink-Projects/Aloft roadmap.md")).toBeVisible();
      await shot(page, "05-desktop-reading-backlinks");
      await visible(page, "notes-mode-edit").click();
    });

    await test.step("renaming rewrites links in other notes", async () => {
      const title = visible(page, "notes-title");
      await title.fill("Calendar sync plan");
      await title.press("Enter");
      await expect
        .poll(fileText("Projects/Aloft roadmap.md"), { timeout: 10_000 })
        .toContain("Ship [[Calendar sync plan]] after notes.");
      await expect(page.getByText("Updated links in 1 note", { exact: false })).toBeVisible();
      expect(await readdir(VAULT)).toContain("Calendar sync plan.md");
    });

    await test.step("search matches text and #tag filters", async () => {
      const search = visible(page, "notes-search");
      await search.fill("rice noodles");
      await expect(visible(page, "notes-row-Recipes/Laksa.md")).toBeVisible();
      await expect(visible(page, "notes-row-Calendar sync plan.md")).toHaveCount(0);
      await shot(page, "06-desktop-search");
      await search.fill("#planning");
      await expect(visible(page, "notes-row-Projects/Aloft roadmap.md")).toBeVisible();
      await expect(visible(page, "notes-row-Recipes/Laksa.md")).toHaveCount(0);
      await search.fill("");
      await visible(page, "notes-tag-aloft").click();
      await expect(visible(page, "notes-row-Recipes/Laksa.md")).toHaveCount(0);
      await visible(page, "notes-scope-all").click();
    });

    await test.step("Today creates the daily note from the template", async () => {
      await visible(page, "notes-today").click();
      await expect(visible(page, "notes-title")).toHaveValue(today());
      await expect(editor(page)).toContainText("## Plan");
      expect(await vaultFile(`Daily/${today()}.md`)).toContain(`# ${today()}`);
      await shot(page, "07-desktop-daily-note");
    });

    await test.step("Command Center capture appends a timed line to today", async () => {
      const panel = await openCommandCenter(page);
      await panel.getByTestId("command-center-input").fill("Capture a thought");
      await panel.getByRole("button", { name: "Notes: Capture a thought", exact: true }).click();
      const input = visible(page, "notes-capture-input");
      await expect(input).toBeVisible();
      await input.fill("Book dentist for Saturday");
      await shot(page, "08-desktop-capture");
      await input.press(`${MOD}+Enter`);
      await expect(page.getByText("Added to today's note", { exact: true })).toBeVisible();
      await expect
        .poll(fileText(`Daily/${today()}.md`), { timeout: 10_000 })
        .toMatch(/- \d\d:\d\d Book dentist for Saturday\n$/);
    });

    await test.step("an edit made in another app shows up in the open note", async () => {
      await openNote(page, "Recipes/Laksa.md");
      const written = Date.now();
      await writeFile(
        path.join(VAULT, "Recipes/Laksa.md"),
        "# Laksa\n\nCoconut milk, rice noodles, prawns, tau pok.\n\nAdded in Obsidian.\n",
        "utf8",
      );
      await expect(editor(page)).toContainText("Added in Obsidian.", { timeout: 6_000 });
      console.log(`[aloft-notes] outside edit visible after ${Date.now() - written} ms`);
    });

    await test.step("editing against a newer file shows a conflict", async () => {
      await editor(page).click();
      await page.keyboard.press(`${MOD}+End`);
      await page.keyboard.type("Mine");
      await writeFile(path.join(VAULT, "Recipes/Laksa.md"), "Theirs\n", "utf8");
      await expect(visible(page, "notes-banner")).toBeVisible({ timeout: 10_000 });
      await shot(page, "09-desktop-conflict");
      await page.getByRole("button", { name: "Use their version", exact: true }).click();
      await expect(editor(page)).toContainText("Theirs");
      await expect(visible(page, "notes-banner")).toHaveCount(0);
    });

    await test.step("New note opens with its title ready; typing straight after renaming keeps the text", async () => {
      await visible(page, "notes-new").click();
      const title = visible(page, "notes-title");
      await expect(title).toHaveValue("Untitled");
      await title.fill("Weekend ideas");
      await title.press("Enter");
      await page.keyboard.type("Kayaking at East Coast");
      await expect
        .poll(fileText("Weekend ideas.md"), { timeout: 10_000 })
        .toContain("Kayaking at East Coast");
      await expect.poll(folderEntries(), { timeout: 10_000 }).not.toContain("Untitled.md");
    });

    await test.step("deleting moves the note into .trash", async () => {
      await visible(page, "notes-delete").click();
      await visible(page, "notes-confirm").click();
      await expect.poll(folderEntries(".trash"), { timeout: 10_000 }).toContain("Weekend ideas.md");
      await expect(visible(page, "notes-empty")).toBeVisible();
    });
  });

  test("phone layout stacks the list and the note", async ({ page }) => {
    await page.setViewportSize(COMPACT);
    await page.goto(`/h/${getServerId()}/plugin/notes/surface/notes`);
    await expect(visible(page, "notes-search")).toBeVisible({ timeout: 60_000 });
    await shot(page, "10-phone-list");
    await visible(page, "notes-row-Projects/Aloft roadmap.md").click();
    await expect(visible(page, "notes-view")).toBeVisible();
    // A phone-width browser edits in place; the native phone app opens notes in Read mode.
    await expect(visible(page, "notes-view")).toContainText("Ship");
    await shot(page, "11-phone-note");
    await visible(page, "notes-back").click();
    await expect(visible(page, "notes-search")).toBeVisible();
  });
});
