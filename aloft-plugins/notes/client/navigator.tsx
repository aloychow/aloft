import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, ScrollView } from "@getpaseo/plugin/client/ui";
import { useCallback, useMemo } from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import { IconButton, SectionLabel, SELECTED, UNSELECTED, usePressStyle } from "./controls";
import { font, radius, space } from "./design";

// The left pane: every way into the vault. Picking a scope filters the note list.

export type Scope =
  | { kind: "all" }
  | { kind: "daily" }
  | { kind: "folder"; folder: string }
  | { kind: "tag"; tag: string };

export function scopeLabel(scope: Scope): string {
  switch (scope.kind) {
    case "all":
      return "All notes";
    case "daily":
      return "Daily notes";
    case "folder":
      return scope.folder.slice(scope.folder.lastIndexOf("/") + 1);
    case "tag":
      return `#${scope.tag}`;
  }
}

const ALL: Scope = { kind: "all" };
const DAILY: Scope = { kind: "daily" };
const scrollStyle: ViewStyle = { flex: 1 };
const scrollContent: ViewStyle = { paddingVertical: space[2] };
const bottomSpace: ViewStyle = { height: space[6] };

function Row(props: {
  theme: PluginTheme;
  icon: string;
  label: string;
  count?: number;
  depth?: number;
  active: boolean;
  scope?: Scope;
  onScope?(scope: Scope): void;
  onPress?(): void;
  testID?: string;
}) {
  const { theme, active, scope, onScope, onPress } = props;
  const colors = theme.colors;
  const depth = props.depth ?? 0;
  const base = useMemo<ViewStyle>(
    () => ({
      flexDirection: "row",
      alignItems: "center",
      gap: space[2],
      marginHorizontal: space[2],
      paddingLeft: space[2] + depth * 14,
      paddingRight: space[2],
      height: 30,
      borderRadius: radius.md,
    }),
    [depth],
  );
  const style = usePressStyle(theme, base, active);
  const textStyles = useMemo(
    () => ({
      label: {
        flex: 1,
        fontSize: font.base,
        color: active ? colors.foreground : colors.foregroundMuted,
      },
      count: { fontSize: font.sm, color: colors.foregroundMuted },
    }),
    [active, colors],
  );
  const press = useCallback(() => {
    if (scope && onScope) onScope(scope);
    else onPress?.();
  }, [onPress, onScope, scope]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={active ? SELECTED : UNSELECTED}
      onPress={press}
      testID={props.testID}
      style={style}
    >
      <Icon
        name={props.icon}
        size={15}
        color={active ? colors.foreground : colors.foregroundMuted}
      />
      <Text numberOfLines={1} style={textStyles.label}>
        {props.label}
      </Text>
      {props.count === undefined ? null : <Text style={textStyles.count}>{props.count}</Text>}
    </Pressable>
  );
}

function FolderRow(props: {
  theme: PluginTheme;
  folder: string;
  count: number;
  active: boolean;
  onScope(scope: Scope): void;
}) {
  const scope = useMemo<Scope>(() => ({ kind: "folder", folder: props.folder }), [props.folder]);
  return (
    <Row
      theme={props.theme}
      icon={props.active ? "FolderOpen" : "Folder"}
      label={props.folder.slice(props.folder.lastIndexOf("/") + 1)}
      count={props.count}
      depth={props.folder.split("/").length - 1}
      active={props.active}
      scope={scope}
      onScope={props.onScope}
      testID={`notes-folder-${props.folder}`}
    />
  );
}

function TagRow(props: {
  theme: PluginTheme;
  tag: string;
  count: number;
  active: boolean;
  onScope(scope: Scope): void;
}) {
  const scope = useMemo<Scope>(() => ({ kind: "tag", tag: props.tag }), [props.tag]);
  return (
    <Row
      theme={props.theme}
      icon="Hash"
      label={props.tag}
      count={props.count}
      active={props.active}
      scope={scope}
      onScope={props.onScope}
      testID={`notes-tag-${props.tag}`}
    />
  );
}

export function Navigator(props: {
  theme: PluginTheme;
  scope: Scope;
  onScope(scope: Scope): void;
  onToday(): void;
  onNewFolder(): void;
  noteCount: number;
  dailyCount: number;
  folders: string[];
  folderCounts: Map<string, number>;
  tags: Array<{ tag: string; count: number }>;
  dailyFolder: string;
}) {
  const { theme, scope, dailyFolder } = props;
  const folders = useMemo(
    () =>
      props.folders.filter(
        (folder) => folder !== dailyFolder && !folder.startsWith(`${dailyFolder}/`),
      ),
    [dailyFolder, props.folders],
  );
  const emptyStyle = useMemo(
    () => ({ paddingHorizontal: space[4], fontSize: font.sm, color: theme.colors.foregroundMuted }),
    [theme],
  );
  const activeTag = scope.kind === "tag" ? scope.tag.toLowerCase() : null;
  const onNewFolder = props.onNewFolder;
  const newFolderButton = useMemo(
    () => (
      <IconButton
        theme={theme}
        icon="FolderPlus"
        label="New folder"
        size={14}
        onPress={onNewFolder}
        testID="notes-new-folder"
      />
    ),
    [onNewFolder, theme],
  );
  const activeFolder = scope.kind === "folder" ? scope.folder : null;
  return (
    <ScrollView style={scrollStyle} contentContainerStyle={scrollContent}>
      <Row
        theme={theme}
        icon="Notebook"
        label="All notes"
        count={props.noteCount}
        active={scope.kind === "all"}
        scope={ALL}
        onScope={props.onScope}
        testID="notes-scope-all"
      />
      <Row
        theme={theme}
        icon="CalendarDays"
        label="Daily notes"
        count={props.dailyCount}
        active={scope.kind === "daily"}
        scope={DAILY}
        onScope={props.onScope}
        testID="notes-scope-daily"
      />
      <Row
        theme={theme}
        icon="Sun"
        label="Today"
        active={false}
        onPress={props.onToday}
        testID="notes-today"
      />

      <SectionLabel theme={theme} trailing={newFolderButton}>
        Folders
      </SectionLabel>
      {folders.length === 0 ? (
        <Text style={emptyStyle}>No folders yet</Text>
      ) : (
        folders.map((folder) => (
          <FolderRow
            key={folder}
            theme={theme}
            folder={folder}
            count={props.folderCounts.get(folder) ?? 0}
            active={folder === activeFolder}
            onScope={props.onScope}
          />
        ))
      )}

      {props.tags.length > 0 ? <SectionLabel theme={theme}>Tags</SectionLabel> : null}
      {props.tags.map(({ tag, count }) => (
        <TagRow
          key={tag}
          theme={theme}
          tag={tag}
          count={count}
          active={tag.toLowerCase() === activeTag}
          onScope={props.onScope}
        />
      ))}
      <View style={bottomSpace} />
    </ScrollView>
  );
}
