import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

// Aloft makes Cmd/Ctrl+Enter the default send shortcut. The shared fixture pins plain Enter for
// upstream specs, so these tests seed settings without a send shortcut to reach the new default.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("@paseo:app-settings", JSON.stringify({ chatDisplay: "full" }));
  });
});

function composerInput(page: Page) {
  return page.getByRole("textbox", { name: "Message agent..." });
}

async function sendDraft(page: Page, draft: string, shortcut: string) {
  const composer = composerInput(page);
  await composer.fill(draft);
  await composer.press(shortcut);
  await expect(composer).toHaveValue("");
  await expect(page.getByText(draft, { exact: true })).toBeVisible();
}

test.describe("Aloft send shortcut default", () => {
  test.describe.configure({ timeout: 180_000 });

  test("Enter inserts a new line and modifier Enter sends by default", async ({ page }) => {
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "aloft-send-default-",
      title: "Aloft send default",
    });
    const modifierLabel = process.platform === "darwin" ? "⌘" : "Ctrl";
    try {
      await openAgentRoute(page, agent);
      const composer = composerInput(page);
      await expect(composer).toBeVisible();

      await composer.fill("First line");
      await composer.press("Enter");
      await expect(composer).toHaveValue("First line\n");
      await composer.press("Shift+Enter");
      await expect(composer).toHaveValue("First line\n\n");

      await sendDraft(page, "Sent with Control", "Control+Enter");
      await sendDraft(page, "Sent with Command", "Meta+Enter");

      await page.keyboard.press(process.platform === "darwin" ? "Meta+Comma" : "Control+Comma");
      await expect(
        page.getByRole("button", { name: `Send shortcut: ${modifierLabel}+Enter`, exact: true }),
      ).toBeVisible();
    } finally {
      await agent.cleanup();
    }
  });

  test("modifier Shift Enter queues while the agent runs", async ({ page }) => {
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "aloft-send-queue-",
      title: "Aloft send queue",
      model: "one-minute-stream",
    });
    try {
      await openAgentRoute(page, agent);
      await expect(composerInput(page)).toBeVisible();
      await sendDraft(page, "Keep running while I queue a follow-up", "Control+Enter");
      await expect(page.getByRole("button", { name: "Stop agent", exact: true })).toBeVisible();

      const composer = composerInput(page);
      await composer.fill("Queued follow-up");
      await composer.press("Enter");
      await expect(composer).toHaveValue("Queued follow-up\n");
      await composer.press("Control+Shift+Enter");
      await expect(composer).toHaveValue("");
      await expect(page.getByRole("button", { name: "Send queued message" })).toHaveCount(1);
    } finally {
      await agent.cleanup();
    }
  });
});
