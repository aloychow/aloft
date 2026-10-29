import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Loading, Markdown, ScrollView, useToast } from "@getpaseo/plugin/client/ui";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform, Pressable, Text, TextInput, View, type ViewStyle } from "react-native";
import {
  type NoteDocument,
  type NoteLinks,
  notesCreate,
  notesRead,
  notesRename,
  notesTrash,
  notesWrite,
} from "../shared/contracts";
import { folderFromPath, titleFromPath, toReadingMarkdown } from "../shared/markdown";
import { useNoteLinks, useRefreshVault } from "./api";
import { type FormatAction, mountNoteEditor, type NoteEditorHandle } from "./codemirror";
import {
  COLLAPSED,
  ConfirmModal,
  EXPANDED,
  IconButton,
  Segmented,
  TextButton,
  usePressStyle,
} from "./controls";
import { font, READING_WIDTH, radius, space, translucent } from "./design";
import { displayTitle, formatEdited, wordCount } from "./format";

const SAVE_DELAY_MS = 500;
const IS_WEB = Platform.OS === "web";
const WEB_NO_OUTLINE = IS_WEB ? ({ outlineStyle: "none" } as object) : null;

type Mode = "edit" | "read";
type SaveState = "saved" | "saving" | "unsaved" | "conflict" | "missing" | "error";

// The mode sticks across notes for the session, like Obsidian's per-pane view mode.
let lastMode: Mode | null = null;

const MODES = [
  { value: "edit", label: "Edit", icon: "PenLine" },
  { value: "read", label: "Read", icon: "BookOpen" },
] as const;

const TOOLBAR: ReadonlyArray<{ action: FormatAction; icon: string; label: string }> = [
  { action: "heading", icon: "Heading2", label: "Heading" },
  { action: "bold", icon: "Bold", label: "Bold" },
  { action: "italic", icon: "Italic", label: "Italic (⌘I)" },
  { action: "strike", icon: "Strikethrough", label: "Strikethrough" },
  { action: "code", icon: "Code", label: "Inline code" },
  { action: "bullet", icon: "List", label: "Bulleted list" },
  { action: "task", icon: "ListChecks", label: "Checklist" },
  { action: "link", icon: "Link2", label: "Link to a note" },
];

function statusLabel(state: SaveState, mtimeMs: number | null): string {
  switch (state) {
    case "saving":
      return "Saving…";
    case "unsaved":
      return "Edited";
    case "error":
      return "Not saved. Edit again to retry";
    case "conflict":
      return "Changed on disk";
    case "missing":
      return "File removed";
    case "saved":
      return mtimeMs ? `Saved ${formatEdited(mtimeMs)}` : "Saved";
  }
}

function statusColor(theme: PluginTheme, state: SaveState): string {
  if (state === "saved") return theme.colors.statusSuccess;
  if (state === "conflict" || state === "missing" || state === "error") {
    return theme.colors.statusDanger;
  }
  return theme.colors.statusWarning;
}

function useViewStyles(theme: PluginTheme, compact: boolean) {
  return useMemo(() => {
    const colors = theme.colors;
    const gutter = compact ? space[4] : 40;
    return {
      root: { flex: 1, minHeight: 0, backgroundColor: colors.surface0 },
      header: {
        height: 44,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: space[1],
        paddingHorizontal: space[2],
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      },
      crumbs: {
        flex: 1,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingLeft: space[1],
      },
      crumbText: { fontSize: font.sm, color: colors.foregroundMuted, flexShrink: 1 },
      divider: { width: 1, height: 18, backgroundColor: colors.border, marginHorizontal: space[1] },
      titleBlock: { paddingTop: compact ? space[4] : space[8], paddingHorizontal: gutter },
      rail: { width: "100%" as const, maxWidth: READING_WIDTH, alignSelf: "center" as const },
      date: { fontSize: font.sm, color: colors.foregroundMuted, marginBottom: space[1] },
      title: {
        fontSize: compact ? font.title : font.title + 4,
        fontWeight: "600" as const,
        color: colors.foreground,
        paddingVertical: 2,
        ...WEB_NO_OUTLINE,
      },
      body: { flex: 1, minHeight: 0 },
      editorHost: { flex: 1, minHeight: 0, paddingTop: space[2] },
      nativeInput: {
        flex: 1,
        paddingHorizontal: space[4],
        paddingTop: space[2],
        paddingBottom: space[12],
        fontSize: 16,
        lineHeight: 24,
        color: colors.foreground,
      },
      reader: { flex: 1 },
      readerContent: { paddingHorizontal: gutter, paddingTop: space[3], paddingBottom: space[12] },
      emptyText: {
        color: colors.foregroundMuted,
        fontSize: font.content,
        fontStyle: "italic" as const,
      },
      linksDrawer: {
        maxHeight: 260,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.surface0,
      },
      linksDrawerContent: { paddingHorizontal: gutter, paddingBottom: space[4] },
      statusBar: {
        height: 30,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: space[3],
        paddingHorizontal: space[4],
        borderTopWidth: 1,
        borderTopColor: colors.border,
      },
      statusText: { fontSize: font.sm, color: colors.foregroundMuted },
      spacer: { flex: 1 },
      errorRoot: {
        flex: 1,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        gap: space[3],
        padding: space[6],
      },
      errorText: {
        color: colors.foregroundMuted,
        fontSize: font.base,
        textAlign: "center" as const,
      },
    };
  }, [compact, theme]);
}

type ViewStyles = ReturnType<typeof useViewStyles>;

export interface NoteViewProps {
  theme: PluginTheme;
  compact: boolean;
  path: string;
  revision: number | null;
  titles: string[];
  tags: string[];
  onOpenPath(path: string): void;
  onOpenLink(target: string): void;
  onRenamed(path: string): void;
  onTrashed(): void;
  onBack?: () => void;
  /** A note just created here opens with its title selected, ready to type over. */
  focusTitle?: boolean;
}

interface DocumentState {
  loaded: boolean;
  loadError: string | null;
  text: string;
  saveState: SaveState;
  conflict: NoteDocument | null;
  mtimeMs: number | null;
}

const INITIAL_DOCUMENT: DocumentState = {
  loaded: false,
  loadError: null,
  text: "",
  saveState: "saved",
  conflict: null,
  mtimeMs: null,
};

/**
 * Loads one note, saves edits 500 ms after the last keystroke, and follows edits made elsewhere
 * while nothing is unsaved. A save against a file that changed meanwhile becomes a conflict.
 * Text the user typed is never dropped: closing a note in conflict saves a conflicted copy.
 */
function useNoteDocument(initialPath: string, revision: number | null) {
  const read = useRpc(notesRead);
  const write = useRpc(notesWrite);
  const create = useRpc(notesCreate);
  const refresh = useRefreshVault();
  const toast = useToast();
  const [doc, setDoc] = useState<DocumentState>(INITIAL_DOCUMENT);
  const baseHash = useRef<string | null>(null);
  const latest = useRef("");
  const unsaved = useRef<string | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const paused = useRef(false);
  const generation = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editor = useRef<NoteEditorHandle | null>(null);
  // A rename moves the file under an open view; every read and write goes to the current path.
  const pathRef = useRef(initialPath);
  // The unmount flush runs after React drops the component; it reads these through refs.
  const rpc = useRef({ write, create, toast });
  rpc.current = { write, create, toast };

  const apply = useCallback((document: NoteDocument) => {
    baseHash.current = document.hash;
    latest.current = document.content;
    unsaved.current = null;
    editor.current?.setText(document.content);
    setDoc((current) => ({
      ...current,
      loaded: true,
      text: document.content,
      mtimeMs: document.mtimeMs,
      conflict: null,
      saveState: "saved",
    }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const document = await read({ path: pathRef.current });
        if (!cancelled) apply(document);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setDoc((current) => ({ ...current, loadError: message }));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [apply, read]);

  const writeOnce = useCallback(
    async (target: string, content: string, force: boolean) => {
      setDoc((current) => ({ ...current, saveState: "saving" }));
      try {
        const result = await write({ path: target, content, baseHash: baseHash.current, force });
        if (result.status === "saved") {
          baseHash.current = result.hash;
          generation.current += 1;
          const clean = unsaved.current === content;
          if (clean) unsaved.current = null;
          setDoc((current) => ({
            ...current,
            mtimeMs: result.mtimeMs,
            conflict: null,
            saveState: clean ? "saved" : "unsaved",
          }));
          void refresh();
        } else if (result.status === "conflict") {
          setDoc((current) => ({ ...current, conflict: result.current, saveState: "conflict" }));
        } else {
          setDoc((current) => ({ ...current, saveState: "missing" }));
        }
      } catch {
        setDoc((current) => ({ ...current, saveState: "error" }));
      }
    },
    [refresh, write],
  );

  /** Saves the latest text. Saves queue behind each other, so none is skipped. */
  const save = useCallback(
    async (force = false): Promise<void> => {
      while (inFlight.current) await inFlight.current;
      const content = unsaved.current;
      if (content === null) return;
      const run = writeOnce(pathRef.current, content, force);
      inFlight.current = run;
      try {
        await run;
      } finally {
        inFlight.current = null;
      }
    },
    [writeOnce],
  );

  const schedule = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (!paused.current) void save();
    }, SAVE_DELAY_MS);
  }, [save]);

  const edit = useCallback(
    (next: string) => {
      latest.current = next;
      unsaved.current = next;
      setDoc((current) => ({
        ...current,
        text: next,
        saveState:
          current.saveState === "conflict" || current.saveState === "missing"
            ? current.saveState
            : "unsaved",
      }));
      schedule();
    },
    [schedule],
  );

  // Follow edits made in other apps while nothing is unsaved here.
  useEffect(() => {
    if (!doc.loaded || unsaved.current !== null || inFlight.current) return undefined;
    let cancelled = false;
    const startedAt = generation.current;
    const follow = async () => {
      try {
        const document = await read({ path: pathRef.current });
        // A save that finished meanwhile makes this read stale.
        if (cancelled || unsaved.current !== null || generation.current !== startedAt) return;
        if (document.hash !== baseHash.current) apply(document);
        else
          setDoc((current) =>
            current.saveState === "missing" ? { ...current, saveState: "saved" } : current,
          );
      } catch {
        if (!cancelled && unsaved.current === null) {
          setDoc((current) => ({ ...current, saveState: "missing" }));
        }
      }
    };
    void follow();
    return () => {
      cancelled = true;
    };
  }, [apply, doc.loaded, read, revision]);

  // Closing a note saves what is pending. A conflict becomes a conflicted copy and a removed
  // file is written back, so leaving a note never drops text.
  useEffect(
    () => () => {
      clearTimeout(saveTimer.current);
      const pending = unsaved.current;
      if (pending === null || paused.current) return;
      const { write: writeNote, create: createNote, toast: notify } = rpc.current;
      const path = pathRef.current;
      const title = titleFromPath(path);
      const keep = async () => {
        while (inFlight.current) await inFlight.current;
        const result = await writeNote({
          path,
          content: pending,
          baseHash: baseHash.current,
          force: false,
        });
        if (result.status === "saved") return;
        if (result.status === "missing") {
          await writeNote({ path, content: pending, baseHash: null, force: true });
          notify.show(`"${title}" was removed elsewhere, so Aloft saved your text back to it.`, {
            variant: "warning",
          });
          return;
        }
        const copy = await createNote({
          title: `${title} (conflicted copy)`,
          folder: folderFromPath(path),
          content: pending,
        });
        notify.show(`"${title}" changed in another app. Your edits are in ${copy.path}.`, {
          variant: "warning",
          durationMs: 6000,
        });
      };
      keep().catch(() => notify.error(`Could not save your last edits to "${title}"`));
    },
    [],
  );

  const conflict = doc.conflict;
  const keepTheirs = useCallback(() => {
    if (conflict) apply(conflict);
  }, [apply, conflict]);
  const keepMine = useCallback(() => void save(true), [save]);
  const saveAgain = useCallback(() => {
    unsaved.current = latest.current;
    void save(true);
  }, [save]);
  const flush = useCallback(async () => {
    clearTimeout(saveTimer.current);
    await save();
  }, [save]);
  /** Holds autosave while the file moves; `moveTo` resumes it at the new path. */
  const pause = useCallback(() => {
    paused.current = true;
    clearTimeout(saveTimer.current);
  }, []);
  const resume = useCallback(() => {
    paused.current = false;
    if (unsaved.current !== null) schedule();
  }, [schedule]);
  /** After a rename, points the view at the new path and saves anything typed meanwhile. */
  const moveTo = useCallback(
    async (target: string) => {
      pathRef.current = target;
      paused.current = false;
      await save();
      if (unsaved.current !== null) schedule();
    },
    [save, schedule],
  );
  const discard = useCallback(() => {
    clearTimeout(saveTimer.current);
    unsaved.current = null;
  }, []);

  return {
    doc,
    editor,
    latest,
    edit,
    keepTheirs,
    keepMine,
    saveAgain,
    flush,
    pause,
    resume,
    moveTo,
    discard,
  };
}

type NoteDocumentApi = ReturnType<typeof useNoteDocument>;

/** Title editing with rename-on-commit, which also rewrites links in other notes. */
function useTitle(path: string, note: NoteDocumentApi, onRenamed: (path: string) => void) {
  const toast = useToast();
  const refresh = useRefreshVault();
  const rename = useRpc(notesRename);
  const [draft, setDraft] = useState(titleFromPath(path));
  useEffect(() => setDraft(titleFromPath(path)), [path]);
  // Enter and blur both end an edit; only the first one renames.
  const committing = useRef(false);
  const { flush, pause, resume, moveTo } = note;
  const commit = useCallback(async () => {
    const next = draft.trim();
    const current = titleFromPath(path);
    if (next.length === 0 || next === current) {
      setDraft(current);
      return;
    }
    if (committing.current) return;
    committing.current = true;
    await flush();
    pause();
    try {
      const result = await rename({ path, title: next });
      await moveTo(result.path);
      void refresh();
      if (result.updatedNotes > 0) {
        const noun = result.updatedNotes === 1 ? "note" : "notes";
        toast.show(`Renamed. Updated links in ${result.updatedNotes} ${noun}.`, {
          variant: "success",
        });
      }
      onRenamed(result.path);
    } catch (error) {
      resume();
      setDraft(current);
      toast.error(error instanceof Error ? error.message : "Could not rename the note");
    } finally {
      committing.current = false;
    }
  }, [draft, flush, moveTo, onRenamed, path, pause, refresh, rename, resume, toast]);
  return { draft, setDraft, commit };
}

export function NoteView(props: NoteViewProps) {
  const { theme, path, compact, onTrashed } = props;
  const styles = useViewStyles(theme, compact);
  const toast = useToast();
  const refresh = useRefreshVault();
  const trash = useRpc(notesTrash);
  const note = useNoteDocument(path, props.revision);
  const { doc, editor, latest, edit, discard } = note;
  const title = useTitle(path, note, props.onRenamed);

  const [mode, setModeState] = useState<Mode>(lastMode ?? (IS_WEB ? "edit" : "read"));
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [showLinks, setShowLinks] = useState(false);
  const editorHost = useRef<View>(null);

  const titlesRef = useRef(props.titles);
  const tagsRef = useRef(props.tags);
  const openLinkRef = useRef(props.onOpenLink);
  titlesRef.current = props.titles;
  tagsRef.current = props.tags;
  openLinkRef.current = props.onOpenLink;

  const setMode = useCallback((next: Mode) => {
    lastMode = next;
    setModeState(next);
  }, []);

  const focusTitle = props.focusTitle ?? false;
  // Read through a ref: the flag clears after a rename, and that must not remount the editor.
  const focusTitleRef = useRef(focusTitle);
  focusTitleRef.current = focusTitle;
  useLayoutEffect(() => {
    if (!doc.loaded || mode !== "edit" || !IS_WEB) return undefined;
    editor.current = mountNoteEditor(editorHost.current, {
      text: latest.current,
      theme,
      placeholder: "Start writing. Type [[ to link a note, # to tag it.",
      gutter: compact ? space[4] : 40,
      onChange: edit,
      onOpenLink: (target) => openLinkRef.current(target),
      getTitles: () => titlesRef.current,
      getTags: () => tagsRef.current,
    });
    if (latest.current.length === 0 && !focusTitleRef.current) editor.current?.focus();
    return () => {
      editor.current?.destroy();
      editor.current = null;
    };
  }, [compact, doc.loaded, edit, editor, latest, mode, theme]);

  const doTrash = useCallback(async () => {
    setConfirmTrash(false);
    discard();
    try {
      await trash({ path });
      void refresh();
      toast.show("Moved to the vault's .trash folder", { variant: "success" });
      onTrashed();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the note");
    }
  }, [discard, onTrashed, path, refresh, toast, trash]);

  const format = useCallback((action: FormatAction) => editor.current?.format(action), [editor]);
  const openTrash = useCallback(() => setConfirmTrash(true), []);
  const closeTrash = useCallback(() => setConfirmTrash(false), []);
  const confirmTrashNow = useCallback(() => void doTrash(), [doTrash]);
  const toggleLinks = useCallback(() => setShowLinks((value) => !value), []);
  const commitTitle = title.commit;
  const onTitleBlur = useCallback(() => void commitTitle(), [commitTitle]);
  // Enter moves on to the body; leaving the title field commits the rename.
  const onTitleSubmit = useCallback(() => {
    if (editor.current) editor.current.focus();
    else void commitTitle();
  }, [commitTitle, editor]);

  const links = useNoteLinks(path, props.revision);
  const noteTitle = titleFromPath(path);
  const friendlyDate = displayTitle(noteTitle);

  if (doc.loadError) {
    return (
      <View style={styles.errorRoot}>
        <Icon name="FileWarning" size={28} color={theme.colors.foregroundMuted} />
        <Text style={styles.errorText}>{doc.loadError}</Text>
        {props.onBack ? (
          <TextButton theme={theme} label="Back to notes" onPress={props.onBack} />
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.root} testID="notes-view">
      <NoteHeader
        theme={theme}
        styles={styles}
        compact={compact}
        folder={folderFromPath(path)}
        mode={mode}
        onMode={setMode}
        onFormat={format}
        onBack={props.onBack}
        onTrash={openTrash}
      />
      {doc.saveState === "conflict" && doc.conflict ? (
        <Banner theme={theme} message="This note changed in another app while you were editing.">
          <TextButton
            theme={theme}
            variant="ghost"
            label="Use their version"
            onPress={note.keepTheirs}
          />
          <TextButton theme={theme} variant="secondary" label="Keep mine" onPress={note.keepMine} />
        </Banner>
      ) : null}
      {doc.saveState === "missing" ? (
        <Banner
          theme={theme}
          message="The file was moved or deleted outside Aloft. Your text is still here."
        >
          <TextButton
            theme={theme}
            variant="secondary"
            label="Save it again"
            onPress={note.saveAgain}
          />
        </Banner>
      ) : null}

      <View style={styles.titleBlock}>
        <View style={styles.rail}>
          {friendlyDate === noteTitle ? null : <Text style={styles.date}>{friendlyDate}</Text>}
          <TextInput
            value={title.draft}
            onChangeText={title.setDraft}
            onBlur={onTitleBlur}
            onSubmitEditing={onTitleSubmit}
            blurOnSubmit
            accessibilityLabel="Note title"
            autoFocus={focusTitle}
            selectTextOnFocus={focusTitle}
            testID="notes-title"
            placeholder="Untitled"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={styles.title}
          />
        </View>
      </View>

      <NoteBody
        theme={theme}
        styles={styles}
        loaded={doc.loaded}
        mode={mode}
        text={doc.text}
        editorHost={editorHost}
        onEdit={edit}
        links={links.data ?? null}
        onOpenPath={props.onOpenPath}
        onOpenLink={props.onOpenLink}
      />

      {mode === "edit" && showLinks ? (
        <View style={styles.linksDrawer}>
          <ScrollView contentContainerStyle={styles.linksDrawerContent}>
            <View style={styles.rail}>
              <LinksPanel
                theme={theme}
                data={links.data ?? null}
                onOpenPath={props.onOpenPath}
                onOpenLink={props.onOpenLink}
              />
            </View>
          </ScrollView>
        </View>
      ) : null}

      <StatusBar
        theme={theme}
        styles={styles}
        compact={compact}
        mode={mode}
        saveState={doc.saveState}
        mtimeMs={doc.mtimeMs}
        text={doc.text}
        linkCount={(links.data?.backlinks.length ?? 0) + (links.data?.outgoing.length ?? 0)}
        showLinks={showLinks}
        onToggleLinks={toggleLinks}
      />

      <ConfirmModal
        theme={theme}
        open={confirmTrash}
        title="Delete note?"
        message={`"${noteTitle}" moves to the .trash folder inside your vault. You can restore it from there in Finder.`}
        confirmLabel="Delete"
        onConfirm={confirmTrashNow}
        onClose={closeTrash}
      />
    </View>
  );
}

function FormatButton(props: {
  theme: PluginTheme;
  action: FormatAction;
  icon: string;
  label: string;
  onFormat(action: FormatAction): void;
}) {
  const { action, onFormat } = props;
  const press = useCallback(() => onFormat(action), [action, onFormat]);
  return <IconButton theme={props.theme} icon={props.icon} label={props.label} onPress={press} />;
}

function NoteHeader(props: {
  theme: PluginTheme;
  styles: ViewStyles;
  compact: boolean;
  folder: string;
  mode: Mode;
  onMode(mode: Mode): void;
  onFormat(action: FormatAction): void;
  onBack?: () => void;
  onTrash(): void;
}) {
  const { theme, styles } = props;
  const showToolbar = props.mode === "edit" && IS_WEB && !props.compact;
  return (
    <View style={styles.header}>
      {props.onBack ? (
        <IconButton
          theme={theme}
          icon="ChevronLeft"
          label="All notes"
          size={18}
          onPress={props.onBack}
          testID="notes-back"
        />
      ) : null}
      <View style={styles.crumbs}>
        {props.folder ? (
          <Icon name="Folder" size={13} color={theme.colors.foregroundMuted} />
        ) : null}
        {props.folder ? (
          <Text numberOfLines={1} style={styles.crumbText}>
            {props.folder.split("/").join(" / ")}
          </Text>
        ) : null}
      </View>
      {showToolbar
        ? TOOLBAR.map((item) => (
            <FormatButton
              key={item.action}
              theme={theme}
              action={item.action}
              icon={item.icon}
              label={item.label}
              onFormat={props.onFormat}
            />
          ))
        : null}
      {showToolbar ? <View style={styles.divider} /> : null}
      <Segmented theme={theme} value={props.mode} options={MODES} onChange={props.onMode} />
      <IconButton
        theme={theme}
        icon="Trash2"
        label="Delete note"
        onPress={props.onTrash}
        testID="notes-delete"
      />
    </View>
  );
}

function NoteBody(props: {
  theme: PluginTheme;
  styles: ViewStyles;
  loaded: boolean;
  mode: Mode;
  text: string;
  editorHost: RefObject<View | null>;
  onEdit(text: string): void;
  links: NoteLinks | null;
  onOpenPath(path: string): void;
  onOpenLink(target: string): void;
}) {
  const { styles, theme } = props;
  if (!props.loaded) {
    return (
      <View style={styles.body}>
        <Loading />
      </View>
    );
  }
  if (props.mode === "edit" && IS_WEB) {
    return (
      <View style={styles.body}>
        <View ref={props.editorHost} style={styles.editorHost} testID="notes-editor" />
      </View>
    );
  }
  if (props.mode === "edit") {
    return (
      <View style={styles.body}>
        <TextInput
          multiline
          value={props.text}
          onChangeText={props.onEdit}
          textAlignVertical="top"
          autoCorrect
          placeholder="Start writing"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.nativeInput}
        />
      </View>
    );
  }
  return (
    <View style={styles.body}>
      <ScrollView
        style={styles.reader}
        contentContainerStyle={styles.readerContent}
        testID="notes-reader"
      >
        <View style={styles.rail}>
          {props.text.trim().length > 0 ? (
            <Markdown>{toReadingMarkdown(props.text)}</Markdown>
          ) : (
            <Text style={styles.emptyText}>
              This note is empty. Switch to Edit to start writing.
            </Text>
          )}
          <LinksPanel
            theme={theme}
            data={props.links}
            onOpenPath={props.onOpenPath}
            onOpenLink={props.onOpenLink}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const linksToggleBase: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  gap: 4,
  paddingHorizontal: space[2],
  height: 22,
  borderRadius: radius.md,
};

function StatusBar(props: {
  theme: PluginTheme;
  styles: ViewStyles;
  compact: boolean;
  mode: Mode;
  saveState: SaveState;
  mtimeMs: number | null;
  text: string;
  linkCount: number;
  showLinks: boolean;
  onToggleLinks(): void;
}) {
  const { theme, styles } = props;
  const words = useMemo(() => wordCount(props.text), [props.text]);
  const dot = useMemo(
    () => ({
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: statusColor(theme, props.saveState),
    }),
    [props.saveState, theme],
  );
  const toggleStyle = usePressStyle(theme, linksToggleBase, props.showLinks);
  return (
    <View style={styles.statusBar}>
      <View style={dot} />
      <Text style={styles.statusText} testID="notes-save-state">
        {statusLabel(props.saveState, props.mtimeMs)}
      </Text>
      <Text style={styles.statusText}>
        {words} {words === 1 ? "word" : "words"}
      </Text>
      <View style={styles.spacer} />
      {props.mode === "edit" && IS_WEB && !props.compact ? (
        <Text style={styles.statusText}>⌘-click a link to open it</Text>
      ) : null}
      {props.mode === "edit" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Links"
          accessibilityState={props.showLinks ? EXPANDED : COLLAPSED}
          onPress={props.onToggleLinks}
          testID="notes-links-toggle"
          style={toggleStyle}
        >
          <Icon name="Link" size={12} color={theme.colors.foregroundMuted} />
          <Text style={styles.statusText}>
            {props.linkCount} {props.linkCount === 1 ? "link" : "links"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Banner(props: { theme: PluginTheme; message: string; children: ReactNode }) {
  const colors = props.theme.colors;
  const styles = useMemo(
    () => ({
      banner: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: space[2],
        paddingHorizontal: space[4],
        paddingVertical: space[2],
        backgroundColor: translucent(colors.statusWarning, 12, colors.surface1),
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      },
      text: { flex: 1, fontSize: font.base, color: colors.foreground },
    }),
    [colors],
  );
  return (
    <View style={styles.banner} testID="notes-banner">
      <Icon name="TriangleAlert" size={15} color={colors.statusWarning} />
      <Text style={styles.text}>{props.message}</Text>
      {props.children}
    </View>
  );
}

const chipBase: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  gap: 4,
  height: 26,
  paddingHorizontal: space[2],
  borderRadius: 13,
  borderWidth: 1,
};

function useLinkStyles(theme: PluginTheme) {
  return useMemo(() => {
    const colors = theme.colors;
    return {
      panel: { marginTop: space[6], gap: space[4] },
      group: { gap: space[1] },
      heading: { fontSize: font.sm, fontWeight: "500" as const, color: colors.foregroundMuted },
      hint: { fontSize: font.sm, color: colors.foregroundMuted },
      cardBase: {
        paddingVertical: space[2],
        paddingHorizontal: space[3],
        borderRadius: radius.lg,
        borderWidth: 1,
        gap: 2,
        borderColor: colors.border,
      },
      cardTitle: { fontSize: font.base, fontWeight: "500" as const, color: colors.foreground },
      cardSnippet: { fontSize: 13, color: colors.foregroundMuted },
      chips: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: space[1.5] },
      chipResolved: { ...chipBase, borderStyle: "solid" as const, borderColor: colors.border },
      chipMissing: {
        ...chipBase,
        borderStyle: "dashed" as const,
        borderColor: colors.foregroundMuted,
      },
      chipText: { fontSize: font.sm, color: colors.foreground },
      chipTextMissing: { fontSize: font.sm, color: colors.foregroundMuted },
    };
  }, [theme]);
}

function BacklinkCard(props: {
  theme: PluginTheme;
  link: NoteLinks["backlinks"][number];
  onOpenPath(path: string): void;
}) {
  const { link, onOpenPath, theme } = props;
  const styles = useLinkStyles(theme);
  const style = usePressStyle(theme, styles.cardBase);
  const press = useCallback(() => onOpenPath(link.path), [link.path, onOpenPath]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${link.title}`}
      onPress={press}
      style={style}
      testID={`notes-backlink-${link.path}`}
    >
      <Text style={styles.cardTitle}>{displayTitle(link.title)}</Text>
      <Text numberOfLines={2} style={styles.cardSnippet}>
        {link.snippet}
      </Text>
    </Pressable>
  );
}

function OutgoingChip(props: {
  theme: PluginTheme;
  link: NoteLinks["outgoing"][number];
  onOpenLink(target: string): void;
}) {
  const { link, onOpenLink, theme } = props;
  const styles = useLinkStyles(theme);
  const style = usePressStyle(theme, link.path ? styles.chipResolved : styles.chipMissing);
  const press = useCallback(() => onOpenLink(link.target), [link.target, onOpenLink]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={link.path ? `Open ${link.label}` : `Create ${link.target}`}
      onPress={press}
      style={style}
      testID={`notes-outgoing-${link.target}`}
    >
      <Icon
        name={link.path ? "FileText" : "FilePlus"}
        size={12}
        color={theme.colors.foregroundMuted}
      />
      <Text style={link.path ? styles.chipText : styles.chipTextMissing}>{link.label}</Text>
    </Pressable>
  );
}

function LinksPanel(props: {
  theme: PluginTheme;
  data: NoteLinks | null;
  onOpenPath(path: string): void;
  onOpenLink(target: string): void;
}) {
  const styles = useLinkStyles(props.theme);
  if (!props.data) return null;
  const { backlinks, outgoing } = props.data;
  return (
    <View style={styles.panel} testID="notes-links">
      <View style={styles.group}>
        <Text style={styles.heading}>Linked mentions · {backlinks.length}</Text>
        {backlinks.length === 0 ? (
          <Text style={styles.hint}>No other note links here yet.</Text>
        ) : (
          backlinks.map((link) => (
            <BacklinkCard
              key={link.path}
              theme={props.theme}
              link={link}
              onOpenPath={props.onOpenPath}
            />
          ))
        )}
      </View>
      {outgoing.length > 0 ? (
        <View style={styles.group}>
          <Text style={styles.heading}>Links in this note · {outgoing.length}</Text>
          <View style={styles.chips}>
            {outgoing.map((link) => (
              <OutgoingChip
                key={link.target}
                theme={props.theme}
                link={link}
                onOpenLink={props.onOpenLink}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}
