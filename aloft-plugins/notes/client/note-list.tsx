import type { PluginTheme } from "@getpaseo/plugin";
import { FlatList, Icon } from "@getpaseo/plugin/client/ui";
import { useCallback, useMemo } from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import { SELECTED, UNSELECTED, usePressStyle } from "./controls";
import { font, radius, space } from "./design";
import { displayTitle, formatEdited } from "./format";

export interface ListItem {
  path: string;
  title: string;
  folder: string;
  detail: string;
  mtimeMs: number | null;
}

const rowBase: ViewStyle = {
  marginHorizontal: space[2],
  paddingHorizontal: space[3],
  paddingVertical: space[2] + 2,
  borderRadius: radius.lg,
  gap: 3,
};
const titleRow: ViewStyle = { flexDirection: "row", alignItems: "baseline", gap: space[2] };
const folderRow: ViewStyle = { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 };
const listContent: ViewStyle = { paddingVertical: space[1], gap: 2 };
const listStyle: ViewStyle = { flex: 1 };

function useRowText(theme: PluginTheme) {
  return useMemo(() => {
    const colors = theme.colors;
    return {
      title: { flex: 1, fontSize: font.base, fontWeight: "500" as const, color: colors.foreground },
      date: { fontSize: font.sm, color: colors.foregroundMuted },
      detail: { fontSize: 13, lineHeight: 18, color: colors.foregroundMuted },
      empty: { fontSize: 13, color: colors.foregroundMuted, fontStyle: "italic" as const },
      folder: { fontSize: 11, color: colors.foregroundMuted },
      emptyState: {
        flex: 1,
        alignItems: "center" as const,
        paddingTop: space[12],
        paddingHorizontal: space[6],
        gap: space[2],
      },
      emptyLabel: {
        fontSize: font.base,
        color: colors.foregroundMuted,
        textAlign: "center" as const,
      },
    };
  }, [theme]);
}

function NoteRow(props: {
  theme: PluginTheme;
  item: ListItem;
  selected: boolean;
  showFolder: boolean;
  onSelect(path: string): void;
}) {
  const { theme, item, onSelect } = props;
  const colors = theme.colors;
  const text = useRowText(theme);
  const style = usePressStyle(theme, rowBase, props.selected);
  const press = useCallback(() => onSelect(item.path), [item.path, onSelect]);
  const title = displayTitle(item.title);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={props.selected ? SELECTED : UNSELECTED}
      onPress={press}
      testID={`notes-row-${item.path}`}
      style={style}
    >
      <View style={titleRow}>
        <Text numberOfLines={1} style={text.title}>
          {title}
        </Text>
        {item.mtimeMs === null ? null : <Text style={text.date}>{formatEdited(item.mtimeMs)}</Text>}
      </View>
      {item.detail.length > 0 ? (
        <Text numberOfLines={2} style={text.detail}>
          {item.detail}
        </Text>
      ) : (
        <Text style={text.empty}>Empty note</Text>
      )}
      {props.showFolder && item.folder ? (
        <View style={folderRow}>
          <Icon name="Folder" size={11} color={colors.foregroundMuted} />
          <Text numberOfLines={1} style={text.folder}>
            {item.folder}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function NoteList(props: {
  theme: PluginTheme;
  items: ListItem[];
  selectedPath: string | null;
  showFolder: boolean;
  emptyLabel: string;
  onSelect(path: string): void;
}) {
  const { theme, selectedPath, showFolder, onSelect } = props;
  const text = useRowText(theme);
  const keyExtractor = useCallback((item: ListItem) => item.path, []);
  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => (
      <NoteRow
        theme={theme}
        item={item}
        selected={item.path === selectedPath}
        showFolder={showFolder}
        onSelect={onSelect}
      />
    ),
    [onSelect, selectedPath, showFolder, theme],
  );
  if (props.items.length === 0) {
    return (
      <View style={text.emptyState}>
        <Icon name="NotebookText" size={28} color={theme.colors.foregroundMuted} />
        <Text style={text.emptyLabel}>{props.emptyLabel}</Text>
      </View>
    );
  }
  return (
    <FlatList
      style={listStyle}
      contentContainerStyle={listContent}
      data={props.items}
      extraData={selectedPath}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
    />
  );
}
