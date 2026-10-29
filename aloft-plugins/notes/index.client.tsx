import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useCallback } from "react";
import { notesCreate } from "./shared/contracts";
import { NOTES_SETTINGS_ID, setNotesClient } from "./client/host";
import { NotesScreen } from "./client/notes-screen";
import { NotesSettingsScreen } from "./client/settings-screen";

function NotesSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const open = useCallback(() => openScreen({ screenId: "notes" }), [openScreen]);
  return (
    <SidebarRow
      icon="NotebookPen"
      label="Notes"
      active={currentScreen?.screenId === "notes"}
      onPress={open}
    />
  );
}

// Each Command Center action opens the screen with a fresh nonce so repeating it still acts.
const nonce = () => String(Date.now());

export default function contribute(client: PluginClientContext) {
  setNotesClient(client);
  const removers = [
    client.addScreen({ id: "notes", title: "Notes", Component: NotesScreen }),
    client.addSidebarHeaderItem({ id: "notes", title: "Notes", Component: NotesSidebarItem }),
    client.addSettingsScreen({
      id: NOTES_SETTINGS_ID,
      title: "Notes",
      icon: "NotebookPen",
      Component: NotesSettingsScreen,
    }),
    client.addCommandCenterItem({
      id: "notes-today",
      title: "Notes: Open today's note",
      icon: "Sun",
      keywords: ["daily", "journal", "today", "notes"],
      context: "global",
      onSelect: ({ openScreen }) => openScreen({ screenId: "notes", params: { today: nonce() } }),
    }),
    client.addCommandCenterItem({
      id: "notes-capture",
      title: "Notes: Capture a thought",
      icon: "Zap",
      keywords: ["quick", "capture", "inbox", "jot", "notes"],
      context: "global",
      onSelect: ({ openScreen }) => openScreen({ screenId: "notes", params: { capture: nonce() } }),
    }),
    client.addCommandCenterItem({
      id: "notes-new",
      title: "Notes: New note",
      icon: "SquarePen",
      keywords: ["create", "write", "notes"],
      context: "global",
      async onSelect({ rpc, openScreen }) {
        const created = await rpc(notesCreate, { title: "Untitled" });
        openScreen({ screenId: "notes", params: { note: created.path, fresh: "1", t: nonce() } });
      },
    }),
    client.addCommandCenterItem({
      id: "notes-search",
      title: "Notes: Search notes",
      icon: "Search",
      keywords: ["find", "notes"],
      context: "global",
      onSelect: ({ openScreen }) => openScreen({ screenId: "notes", params: { search: nonce() } }),
    }),
  ];
  return () => {
    for (const remove of removers) remove();
    setNotesClient(null);
  };
}
