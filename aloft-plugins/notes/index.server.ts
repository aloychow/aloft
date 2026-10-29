import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  notesAppend,
  notesCreate,
  notesCreateFolder,
  notesDaily,
  notesIndex,
  notesLinks,
  notesRead,
  notesRename,
  notesSearch,
  notesStatus,
  notesTrash,
  notesWrite,
} from "./shared/contracts";
import { notesSettings } from "./shared/settings";
import { VaultManager } from "./server/manager";
import { createNotesTools } from "./server/tools";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(notesSettings);
  const manager = new VaultManager(async () => {
    const state = await settings.read();
    return state.status === "ready" ? state.values : notesSettings.schema.parse({});
  });
  const vault = () => manager.vault();

  server.handle(notesStatus, () => manager.status());
  server.handle(notesIndex, async () => {
    const current = await vault();
    return {
      revision: current.revision,
      notes: current.list(),
      folders: current.folderList(),
      tags: current.tagCounts(),
      dailyPath: current.dailyPath(),
    };
  });
  server.handle(notesRead, async ({ path }) => (await vault()).read(path));
  server.handle(notesWrite, async ({ path, content, baseHash, force }) =>
    (await vault()).write(path, content, baseHash, force),
  );
  server.handle(notesCreate, async (input) => (await vault()).create(input));
  server.handle(notesCreateFolder, async ({ folder }) => (await vault()).createFolder(folder));
  server.handle(notesRename, async ({ path, title, folder }) =>
    (await vault()).rename(path, { title, folder }),
  );
  server.handle(notesTrash, async ({ path }) => (await vault()).trash(path));
  server.handle(notesDaily, async () => (await vault()).daily());
  server.handle(notesAppend, async ({ target, text, timestamp }) =>
    (await vault()).append(target, text, { timestamp }),
  );
  server.handle(notesSearch, async ({ query, limit, folder, tag }) => ({
    hits: (await vault()).search(query, { limit, folder, tag }),
  }));
  server.handle(notesLinks, async ({ path }) => (await vault()).links(path));

  const tools = createNotesTools(vault);
  server.addHook("agent.open.before", async ({ request }) => {
    if (request.purpose === "history") return undefined;
    if (!(await manager.settings()).agentTools) return undefined;
    return { ...request, tools: [...request.tools, ...tools] };
  });

  // Index an existing vault so the first screen opens fast. A new vault is created on first use.
  void manager.warm();

  return () => manager.dispose();
}
