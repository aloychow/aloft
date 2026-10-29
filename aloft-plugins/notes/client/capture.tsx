import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useCallback, useMemo, useState } from "react";
import {
  type NativeSyntheticEvent,
  Platform,
  Text,
  type TextInputKeyPressEventData,
  View,
  type ViewStyle,
} from "react-native";
import { notesAppend } from "../shared/contracts";
import { useRefreshVault } from "./api";
import { TextButton } from "./controls";
import { font, radius, space } from "./design";

const IS_WEB = Platform.OS === "web";
const userAgent = (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent ?? "";
const MODIFIER = !IS_WEB || /Mac|iPhone|iPad/.test(userAgent) ? "⌘" : "Ctrl";
const WEB_NO_OUTLINE = IS_WEB ? ({ outlineStyle: "none" } as object) : null;
const actions: ViewStyle = { flexDirection: "row", alignItems: "center", gap: space[2] };
const promptActions: ViewStyle = {
  flexDirection: "row",
  justifyContent: "flex-end",
  gap: space[2],
};

function useFieldStyles(theme: PluginTheme) {
  return useMemo(() => {
    const colors = theme.colors;
    const field = {
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
      color: colors.foreground,
      ...WEB_NO_OUTLINE,
    };
    return {
      area: {
        ...field,
        minHeight: 120,
        padding: space[3],
        fontSize: font.content,
        lineHeight: 22,
        textAlignVertical: "top" as const,
      },
      line: { ...field, height: 36, paddingHorizontal: space[3], fontSize: font.base },
      hint: { flex: 1, fontSize: font.sm, color: colors.foregroundMuted },
    };
  }, [theme]);
}

/** Quick capture: one box, saved as a timestamped line in today's daily note. */
export function CaptureModal(props: {
  theme: PluginTheme;
  open: boolean;
  onClose(): void;
  onSaved(path: string): void;
}) {
  const { theme, onClose, onSaved } = props;
  const styles = useFieldStyles(theme);
  const append = useRpc(notesAppend);
  const refresh = useRefreshVault();
  const toast = useToast();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || saving) return;
    setSaving(true);
    try {
      const result = await append({ target: "today", text: trimmed, timestamp: true });
      void refresh();
      setText("");
      toast.show("Added to today's note", { variant: "success" });
      onSaved(result.path);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the capture");
    } finally {
      setSaving(false);
    }
  }, [append, onClose, onSaved, refresh, saving, text, toast]);

  const onKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      const native = event.nativeEvent as TextInputKeyPressEventData & {
        metaKey?: boolean;
        ctrlKey?: boolean;
      };
      if (native.key !== "Enter" || !(native.metaKey || native.ctrlKey)) return;
      (event as unknown as { preventDefault?: () => void }).preventDefault?.();
      void save();
    },
    [save],
  );
  const onOpenChange = useCallback((open: boolean) => !open && onClose(), [onClose]);
  const onSavePress = useCallback(() => void save(), [save]);

  return (
    <Modal title="Quick capture" open={props.open} onOpenChange={onOpenChange}>
      <Modal.Content>
        <TextInput
          autoFocus
          multiline
          value={text}
          onChangeText={setText}
          placeholder="What's on your mind?"
          placeholderTextColor={theme.colors.foregroundMuted}
          testID="notes-capture-input"
          onKeyPress={onKeyPress}
          style={styles.area}
        />
        <View style={actions}>
          <Text style={styles.hint}>
            {IS_WEB
              ? `Saved to today's daily note with the time. ${MODIFIER}↵ to save.`
              : "Saved to today's daily note with the time."}
          </Text>
          <TextButton theme={theme} label="Cancel" variant="ghost" onPress={onClose} />
          <TextButton
            theme={theme}
            label="Add to today"
            variant="primary"
            icon="CornerDownLeft"
            disabled={text.trim().length === 0 || saving}
            onPress={onSavePress}
            testID="notes-capture-save"
          />
        </View>
      </Modal.Content>
    </Modal>
  );
}

/** A one-field prompt, used for new folders. */
export function NamePrompt(props: {
  theme: PluginTheme;
  open: boolean;
  title: string;
  placeholder: string;
  actionLabel: string;
  onSubmit(value: string): void;
  onClose(): void;
}) {
  const { onClose, onSubmit } = props;
  const styles = useFieldStyles(props.theme);
  const [value, setValue] = useState("");
  const submit = useCallback(() => {
    if (value.trim().length === 0) return;
    onSubmit(value.trim());
    setValue("");
  }, [onSubmit, value]);
  const onOpenChange = useCallback((open: boolean) => !open && onClose(), [onClose]);
  return (
    <Modal title={props.title} open={props.open} onOpenChange={onOpenChange}>
      <Modal.Content>
        <TextInput
          autoFocus
          value={value}
          onChangeText={setValue}
          onSubmitEditing={submit}
          placeholder={props.placeholder}
          placeholderTextColor={props.theme.colors.foregroundMuted}
          testID="notes-name-input"
          style={styles.line}
        />
        <View style={promptActions}>
          <TextButton theme={props.theme} label="Cancel" variant="ghost" onPress={onClose} />
          <TextButton
            theme={props.theme}
            label={props.actionLabel}
            variant="primary"
            disabled={value.trim().length === 0}
            onPress={submit}
            testID="notes-name-submit"
          />
        </View>
      </Modal.Content>
    </Modal>
  );
}
