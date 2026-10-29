import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Loading, Modal, useToast } from "@getpaseo/plugin/client/ui";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type LayoutChangeEvent,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";
import { type NoteSummary, notesCreate, notesCreateFolder, notesDaily } from "../shared/contracts";
import { folderFromPath, resolveLinkTarget, sanitizeTitle } from "../shared/markdown";
import { useNoteSearch, useRefreshVault, useVault } from "./api";
import { CaptureModal, NamePrompt } from "./capture";
import { IconButton, TextButton } from "./controls";
import { font, LIST_WIDTH, radius, SIDEBAR_WIDTH, space } from "./design";
import { openNotesSettings } from "./host";
import { Navigator, type Scope, scopeLabel } from "./navigator";
import { type ListItem, NoteList } from "./note-list";
import { NoteView } from "./note-view";

const THREE_PANE_MIN = 980;
const TWO_PANE_MIN = 640;
const WEB_NO_OUTLINE = Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null;
const SCOPE_ALL: Scope = { kind: "all" };
const pickerContent: ViewStyle = { padding: 0, gap: 0 };
const pickerBody: ViewStyle = { minHeight: 360 };
const flexFill: ViewStyle = { flex: 1, minWidth: 0 };

function paneCount(compact: boolean, width: number): 1 | 2 | 3 {
  if (compact || (width > 0 && width < TWO_PANE_MIN)) return 1;
  return width >= THREE_PANE_MIN ? 3 : 2;
}

function inScope(note: NoteSummary, scope: Scope, isDaily: (path: string) => boolean): boolean {
  switch (scope.kind) {
    case "all":
      return true;
    case "daily":
      return isDaily(note.path);
    case "folder":
      return note.path.startsWith(`${scope.folder}/`);
    case "tag": {
      const wanted = scope.tag.toLowerCase();
      return note.tags.some((tag) => {
        const lower = tag.toLowerCase();
        return lower === wanted || lower.startsWith(`${wanted}/`);
      });
    }
  }
}

function emptyLabel(searching: boolean, query: string, scope: Scope): string {
  if (searching) return `Nothing matches "${query.trim()}"`;
  if (scope.kind === "daily") return "No daily notes yet. Open today's note to start one.";
  return "No notes here yet";
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function useScreenStyles(theme: PluginTheme) {
  return useMemo(() => {
    const colors = theme.colors;
    return {
      root: {
        flex: 1,
        minHeight: 0,
        flexDirection: "row" as const,
        backgroundColor: colors.surface0,
      },
      loading: { flex: 1, backgroundColor: colors.surface0 },
      navigatorPane: { width: SIDEBAR_WIDTH, borderRightWidth: 1, borderRightColor: colors.border },
      listPane: { width: LIST_WIDTH, borderRightWidth: 1, borderRightColor: colors.border },
      listFill: { flex: 1, minHeight: 0 },
      listHeader: { padding: space[3], paddingBottom: space[2], gap: space[2] },
      searchBox: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: space[2],
        height: 34,
        paddingHorizontal: space[3],
        borderRadius: radius.lg,
        backgroundColor: colors.surface1,
        borderWidth: 1,
        borderColor: colors.border,
      },
      searchInput: { flex: 1, fontSize: font.base, color: colors.foreground, ...WEB_NO_OUTLINE },
      toolbar: { flexDirection: "row" as const, alignItems: "center" as const, gap: space[1] },
      listTitle: {
        flex: 1,
        fontSize: font.base,
        fontWeight: "500" as const,
        color: colors.foreground,
      },
      listCount: { color: colors.foregroundMuted, fontWeight: "400" as const },
      scopeButton: {
        flex: 1,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
      },
      scopeTitle: { fontSize: font.base, fontWeight: "500" as const, color: colors.foreground },
      scopeCount: { fontSize: font.base, color: colors.foregroundMuted },
      centred: {
        flex: 1,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        gap: space[4],
        padding: space[8],
        backgroundColor: colors.surface0,
      },
      emptyIcon: {
        width: 56,
        height: 56,
        borderRadius: 16,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        backgroundColor: colors.surface1,
        borderWidth: 1,
        borderColor: colors.border,
      },
      emptyCopy: { alignItems: "center" as const, gap: space[1] },
      emptyTitle: { fontSize: font.lg, fontWeight: "500" as const, color: colors.foreground },
      emptyBody: {
        fontSize: font.base,
        color: colors.foregroundMuted,
        textAlign: "center" as const,
        maxWidth: 360,
        lineHeight: 20,
      },
      emptyActions: { flexDirection: "row" as const, gap: space[2] },
      hint: { fontSize: font.sm, color: colors.foregroundMuted },
    };
  }, [theme]);
}

type ScreenStyles = ReturnType<typeof useScreenStyles>;

/** Selection, creation and navigation actions shared by every layout. */
function useNotesActions(scope: Scope) {
  const toast = useToast();
  const refresh = useRefreshVault();
  const createNote = useRpc(notesCreate);
  const createFolderRpc = useRpc(notesCreateFolder);
  const openDailyRpc = useRpc(notesDaily);
  const [selected, setSelected] = useState<string | null>(null);
  const [freshPath, setFreshPath] = useState<string | null>(null);
  const [showNote, setShowNote] = useState(false);
  // The note view remounts only when a different note opens; a rename keeps the same view so
  // focus and in-progress typing survive it.
  const [viewKey, setViewKey] = useState(0);
  const selectedRef = useRef<string | null>(null);

  const select = useCallback((path: string, fresh = false) => {
    if (selectedRef.current !== path) setViewKey((key) => key + 1);
    selectedRef.current = path;
    setSelected(path);
    setFreshPath(fresh ? path : null);
    setShowNote(true);
  }, []);

  const renamed = useCallback((path: string) => {
    selectedRef.current = path;
    setSelected(path);
    setFreshPath(null);
  }, []);

  const openToday = useCallback(async () => {
    try {
      const daily = await openDailyRpc({});
      void refresh();
      select(daily.path);
    } catch (error) {
      toast.error(messageOf(error, "Could not open today's note"));
    }
  }, [openDailyRpc, refresh, select, toast]);

  const newNote = useCallback(async () => {
    try {
      const folder = scope.kind === "folder" ? scope.folder : undefined;
      const created = await createNote({ title: "Untitled", folder });
      void refresh();
      select(created.path, true);
    } catch (error) {
      toast.error(messageOf(error, "Could not create the note"));
    }
  }, [createNote, refresh, scope, select, toast]);

  const createFolder = useCallback(
    async (name: string): Promise<string | null> => {
      try {
        const result = await createFolderRpc({ folder: name });
        void refresh();
        return result.folder;
      } catch (error) {
        toast.error(messageOf(error, "Could not create the folder"));
        return null;
      }
    },
    [createFolderRpc, refresh, toast],
  );

  /** Follows a [[link]]; a link to a missing note creates it, as in Obsidian. */
  const openLink = useCallback(
    async (target: string, notePaths: Iterable<string>) => {
      const resolved = resolveLinkTarget(target, notePaths);
      if (resolved) {
        select(resolved);
        return;
      }
      const slash = target.lastIndexOf("/");
      try {
        const created = await createNote({
          title: sanitizeTitle(slash >= 0 ? target.slice(slash + 1) : target),
          folder: slash >= 0 ? target.slice(0, slash) : undefined,
        });
        void refresh();
        select(created.path);
        toast.show(`Created "${target}"`, { variant: "success" });
      } catch (error) {
        toast.error(messageOf(error, "Could not create the note"));
      }
    },
    [createNote, refresh, select, toast],
  );

  const clearSelection = useCallback(() => {
    selectedRef.current = null;
    setSelected(null);
    setShowNote(false);
  }, []);

  return {
    selected,
    viewKey,
    renamed,
    freshPath,
    showNote,
    setShowNote,
    select,
    openToday,
    newNote,
    createFolder,
    openLink,
    clearSelection,
  };
}

export function NotesScreen({ theme, layout, params }: PluginScreenProps) {
  const styles = useScreenStyles(theme);
  const { status, index, revision } = useVault();
  const [width, setWidth] = useState(0);
  const [scope, setScope] = useState<Scope>(SCOPE_ALL);
  const [query, setQuery] = useState("");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [folderPromptOpen, setFolderPromptOpen] = useState(false);
  const [scopePickerOpen, setScopePickerOpen] = useState(false);
  const searchInput = useRef<TextInput>(null);
  const actions = useNotesActions(scope);
  const { select, openToday, newNote, setShowNote } = actions;
  const panes = paneCount(layout.compact, width);

  // Deep links from the Command Center: ?note=, ?fresh=, ?today=, ?capture=, ?search=.
  const handledParams = useRef("");
  useEffect(() => {
    const signature = JSON.stringify(params);
    if (signature === handledParams.current) return;
    handledParams.current = signature;
    if (params.note) select(params.note, Boolean(params.fresh));
    if (params.today) void openToday();
    if (params.capture) setCaptureOpen(true);
    if (params.search) {
      setShowNote(false);
      setTimeout(() => searchInput.current?.focus(), 50);
    }
  }, [openToday, params, select, setShowNote]);

  const notes = useMemo(() => index?.notes ?? [], [index]);
  const dailyFolder = index ? folderFromPath(index.dailyPath) : "Daily";
  const isDaily = useCallback(
    (path: string) => (dailyFolder ? path.startsWith(`${dailyFolder}/`) : !path.includes("/")),
    [dailyFolder],
  );
  const byPath = useMemo(() => new Map(notes.map((note) => [note.path, note])), [notes]);
  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of notes) {
      const parts = note.folder ? note.folder.split("/") : [];
      for (let i = 1; i <= parts.length; i += 1) {
        const key = parts.slice(0, i).join("/");
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  }, [notes]);

  const search = useNoteSearch(query, revision);
  const searching = query.trim().length > 0;
  const items: ListItem[] = useMemo(() => {
    if (searching) {
      return (search.data?.hits ?? []).map((hit) => ({
        path: hit.path,
        title: hit.title,
        folder: hit.folder,
        detail: hit.snippet,
        mtimeMs: byPath.get(hit.path)?.mtimeMs ?? null,
      }));
    }
    const filtered = notes.filter((note) => inScope(note, scope, isDaily));
    if (scope.kind === "daily") filtered.sort((a, b) => b.path.localeCompare(a.path));
    return filtered.map((note) => ({
      path: note.path,
      title: note.title,
      folder: note.folder,
      detail: note.preview,
      mtimeMs: note.mtimeMs,
    }));
  }, [byPath, isDaily, notes, scope, search.data, searching]);

  const titles = useMemo(() => notes.map((note) => note.title), [notes]);
  const tags = useMemo(() => (index?.tags ?? []).map((entry) => entry.tag), [index]);
  const dailyCount = useMemo(
    () => notes.filter((note) => isDaily(note.path)).length,
    [isDaily, notes],
  );

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width),
    [],
  );
  const onScope = useCallback(
    (next: Scope) => {
      setScope(next);
      setQuery("");
      setScopePickerOpen(false);
      if (panes === 1) setShowNote(false);
    },
    [panes, setShowNote],
  );
  const onNavigatorToday = useCallback(() => {
    setScopePickerOpen(false);
    void openToday();
  }, [openToday]);
  const onNewFolder = useCallback(() => {
    setScopePickerOpen(false);
    setFolderPromptOpen(true);
  }, []);
  const onFolderSubmit = useCallback(
    async (name: string) => {
      setFolderPromptOpen(false);
      const folder = await actions.createFolder(name);
      if (folder) setScope({ kind: "folder", folder });
    },
    [actions],
  );
  const onFolderSubmitPress = useCallback(
    (name: string) => void onFolderSubmit(name),
    [onFolderSubmit],
  );
  const closeFolderPrompt = useCallback(() => setFolderPromptOpen(false), []);
  const openCapture = useCallback(() => setCaptureOpen(true), []);
  const closeCapture = useCallback(() => setCaptureOpen(false), []);
  const onCaptured = useCallback((path: string) => panes > 1 && select(path), [panes, select]);
  const openScopePicker = useCallback(() => setScopePickerOpen(true), []);
  const onToday = useCallback(() => void openToday(), [openToday]);
  const onNewNote = useCallback(() => void newNote(), [newNote]);
  const onSelect = useCallback((path: string) => select(path), [select]);
  const openLinkAction = actions.openLink;
  const onOpenLink = useCallback(
    (target: string) => void openLinkAction(target, [...byPath.keys()]),
    [byPath, openLinkAction],
  );
  const onRenamed = actions.renamed;
  const onBack = useCallback(() => setShowNote(false), [setShowNote]);

  if (status?.error)
    return (
      <VaultError theme={theme} styles={styles} path={status.vaultPath} error={status.error} />
    );
  if (!index) {
    return (
      <View style={styles.loading} onLayout={onLayout}>
        <Loading />
      </View>
    );
  }

  const navigator = (
    <Navigator
      theme={theme}
      scope={scope}
      onScope={onScope}
      onToday={onNavigatorToday}
      onNewFolder={onNewFolder}
      noteCount={notes.length}
      dailyCount={dailyCount}
      folders={index.folders}
      folderCounts={folderCounts}
      tags={index.tags}
      dailyFolder={dailyFolder}
    />
  );

  const listPane = (
    <ListPane
      theme={theme}
      styles={styles}
      panes={panes}
      title={searching ? "Search" : scopeLabel(scope)}
      query={query}
      onQuery={setQuery}
      searchInput={searchInput}
      items={items}
      selected={actions.selected}
      showFolder={searching || scope.kind === "all" || scope.kind === "tag"}
      emptyLabel={emptyLabel(searching, query, scope)}
      onSelect={onSelect}
      onToday={onToday}
      onCapture={openCapture}
      onNewNote={onNewNote}
      onPickScope={openScopePicker}
    />
  );

  const noteView = actions.selected ? (
    <NoteView
      key={actions.viewKey}
      theme={theme}
      compact={panes === 1}
      path={actions.selected}
      revision={revision}
      titles={titles}
      tags={tags}
      focusTitle={actions.freshPath === actions.selected}
      onOpenPath={onSelect}
      onOpenLink={onOpenLink}
      onRenamed={onRenamed}
      onTrashed={actions.clearSelection}
      onBack={panes === 1 ? onBack : undefined}
    />
  ) : (
    <EmptyNote
      theme={theme}
      styles={styles}
      onToday={onToday}
      onNew={onNewNote}
      onCapture={openCapture}
    />
  );

  return (
    <View style={styles.root} onLayout={onLayout} testID="notes-screen">
      {panes === 1 ? (
        <View style={flexFill}>{actions.showNote && actions.selected ? noteView : listPane}</View>
      ) : null}
      {panes === 3 ? <View style={styles.navigatorPane}>{navigator}</View> : null}
      {panes > 1 ? <View style={styles.listPane}>{listPane}</View> : null}
      {panes > 1 ? <View style={flexFill}>{noteView}</View> : null}

      <CaptureModal theme={theme} open={captureOpen} onClose={closeCapture} onSaved={onCaptured} />
      <NamePrompt
        theme={theme}
        open={folderPromptOpen}
        title="New folder"
        placeholder="Folder name, for example Work/Projects"
        actionLabel="Create folder"
        onClose={closeFolderPrompt}
        onSubmit={onFolderSubmitPress}
      />
      <Modal title="Browse notes" open={scopePickerOpen} onOpenChange={setScopePickerOpen}>
        <Modal.Content scrollable={false} contentContainerStyle={pickerContent} style={pickerBody}>
          {navigator}
        </Modal.Content>
      </Modal>
    </View>
  );
}

function ListPane(props: {
  theme: PluginTheme;
  styles: ScreenStyles;
  panes: 1 | 2 | 3;
  title: string;
  query: string;
  onQuery(query: string): void;
  searchInput: RefObject<TextInput | null>;
  items: ListItem[];
  selected: string | null;
  showFolder: boolean;
  emptyLabel: string;
  onSelect(path: string): void;
  onToday(): void;
  onCapture(): void;
  onNewNote(): void;
  onPickScope(): void;
}) {
  const { theme, styles, onQuery } = props;
  const clear = useCallback(() => onQuery(""), [onQuery]);
  return (
    <View style={styles.listFill}>
      <View style={styles.listHeader}>
        <View style={styles.searchBox}>
          <Icon name="Search" size={15} color={theme.colors.foregroundMuted} />
          <TextInput
            ref={props.searchInput}
            value={props.query}
            onChangeText={onQuery}
            placeholder="Search notes or #tag"
            placeholderTextColor={theme.colors.foregroundMuted}
            accessibilityLabel="Search notes"
            testID="notes-search"
            style={styles.searchInput}
          />
          {props.query.length > 0 ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={clear}>
              <Icon name="X" size={14} color={theme.colors.foregroundMuted} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.toolbar}>
          {props.panes === 3 ? (
            <Text style={styles.listTitle} numberOfLines={1}>
              {props.title}
              <Text style={styles.listCount}>{`  ${props.items.length}`}</Text>
            </Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose folder or tag"
              onPress={props.onPickScope}
              testID="notes-scope-picker"
              style={styles.scopeButton}
            >
              <Text style={styles.scopeTitle} numberOfLines={1}>
                {props.title}
              </Text>
              <Text style={styles.scopeCount}>{props.items.length}</Text>
              <Icon name="ChevronDown" size={14} color={theme.colors.foregroundMuted} />
            </Pressable>
          )}
          {props.panes === 3 ? null : (
            <IconButton
              theme={theme}
              icon="Sun"
              label="Today's note"
              onPress={props.onToday}
              testID="notes-today-button"
            />
          )}
          <IconButton
            theme={theme}
            icon="Zap"
            label="Quick capture"
            onPress={props.onCapture}
            testID="notes-capture"
          />
          <IconButton
            theme={theme}
            icon="SquarePen"
            label="New note"
            onPress={props.onNewNote}
            testID="notes-new"
          />
        </View>
      </View>
      <NoteList
        theme={theme}
        items={props.items}
        selectedPath={props.selected}
        showFolder={props.showFolder}
        emptyLabel={props.emptyLabel}
        onSelect={props.onSelect}
      />
    </View>
  );
}

function EmptyNote(props: {
  theme: PluginTheme;
  styles: ScreenStyles;
  onToday(): void;
  onNew(): void;
  onCapture(): void;
}) {
  const { styles, theme } = props;
  return (
    <View style={styles.centred} testID="notes-empty">
      <View style={styles.emptyIcon}>
        <Icon name="NotebookPen" size={26} color={theme.colors.foregroundMuted} />
      </View>
      <View style={styles.emptyCopy}>
        <Text style={styles.emptyTitle}>{"Pick a note, or start today's"}</Text>
        <Text style={styles.emptyBody}>
          Notes are Markdown files in your vault. Link them with [[ and tag them with #.
        </Text>
      </View>
      <View style={styles.emptyActions}>
        <TextButton
          theme={theme}
          label="Open today's note"
          icon="Sun"
          variant="primary"
          onPress={props.onToday}
          testID="notes-empty-today"
        />
        <TextButton theme={theme} label="New note" icon="SquarePen" onPress={props.onNew} />
      </View>
      <Pressable accessibilityRole="button" onPress={props.onCapture}>
        <Text style={styles.hint}>{'Quick capture from anywhere: ⌘K, then "Capture"'}</Text>
      </Pressable>
    </View>
  );
}

function VaultError(props: {
  theme: PluginTheme;
  styles: ScreenStyles;
  path: string;
  error: string;
}) {
  const { styles, theme } = props;
  return (
    <View style={styles.centred}>
      <Icon name="FolderX" size={32} color={theme.colors.foregroundMuted} />
      <Text style={styles.emptyTitle}>{"Can't open your notes folder"}</Text>
      <Text style={styles.emptyBody}>{`${props.path}\n${props.error}`}</Text>
      <TextButton
        theme={theme}
        label="Open Notes settings"
        variant="primary"
        onPress={openNotesSettings}
      />
    </View>
  );
}
