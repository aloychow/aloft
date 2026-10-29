import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal } from "@getpaseo/plugin/client/ui";
import { type ReactNode, useCallback, useMemo } from "react";
import {
  Pressable,
  type PressableStateCallbackType,
  type StyleProp,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { font, radius, space, translucent } from "./design";

// Small controls shared by the Notes surfaces. They follow the host design rules: ghost icon
// actions with a soft hover fill, one accent button per surface, red only inside a confirm.

type PressState = PressableStateCallbackType & { hovered?: boolean };

export const SELECTED = { selected: true } as const;
export const UNSELECTED = { selected: false } as const;
export const EXPANDED = { expanded: true } as const;
export const COLLAPSED = { expanded: false } as const;

export function hoverFill(theme: PluginTheme, state: PressState, active = false): string {
  if (active) return translucent(theme.colors.accent, 14, theme.colors.surface2);
  if (state.pressed) return translucent(theme.colors.foreground, 10, theme.colors.surface2);
  if (state.hovered) return translucent(theme.colors.foreground, 6, theme.colors.surface1);
  return "transparent";
}

/** A memoized Pressable style: `base` plus the hover, press and active fill. */
export function usePressStyle(
  theme: PluginTheme,
  base: ViewStyle,
  active = false,
): (state: PressableStateCallbackType) => StyleProp<ViewStyle> {
  return useCallback(
    (state: PressableStateCallbackType) => [
      base,
      { backgroundColor: hoverFill(theme, state as PressState, active) },
    ],
    [active, base, theme],
  );
}

const iconButtonBase: ViewStyle = {
  width: 30,
  height: 30,
  borderRadius: radius.md,
  alignItems: "center",
  justifyContent: "center",
};
const iconButtonDisabled: ViewStyle = { ...iconButtonBase, opacity: 0.4 };

export function IconButton(props: {
  theme: PluginTheme;
  icon: string;
  label: string;
  onPress(): void;
  active?: boolean;
  disabled?: boolean;
  size?: number;
  testID?: string;
}) {
  const style = usePressStyle(
    props.theme,
    props.disabled ? iconButtonDisabled : iconButtonBase,
    props.active,
  );
  // Web shows the label as a native tooltip.
  const tooltip = useMemo(() => ({ title: props.label }), [props.label]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={props.active ? SELECTED : UNSELECTED}
      {...tooltip}
      disabled={props.disabled}
      onPress={props.onPress}
      testID={props.testID}
      style={style}
    >
      <Icon
        name={props.icon}
        size={props.size ?? 16}
        color={props.active ? props.theme.colors.foreground : props.theme.colors.foregroundMuted}
      />
    </Pressable>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

function buttonOpacity(disabled: boolean | undefined, pressed: boolean): number {
  if (disabled) return 0.5;
  return pressed ? 0.85 : 1;
}

function buttonColors(theme: PluginTheme, variant: ButtonVariant) {
  const colors = theme.colors;
  switch (variant) {
    case "primary":
      return { fill: colors.accent, text: colors.accentForeground };
    case "destructive":
      return { fill: colors.statusDanger, text: colors.accentForeground };
    case "secondary":
      return { fill: colors.surface2, text: colors.foreground };
    case "ghost":
      return { fill: "transparent", text: colors.foreground };
  }
}

export function TextButton(props: {
  theme: PluginTheme;
  label: string;
  onPress(): void;
  icon?: string;
  variant?: ButtonVariant;
  disabled?: boolean;
  testID?: string;
}) {
  const variant = props.variant ?? "secondary";
  const { theme, disabled } = props;
  const { fill, text } = buttonColors(theme, variant);
  const style = useCallback(
    (state: PressableStateCallbackType) => ({
      height: 32,
      paddingHorizontal: space[3],
      borderRadius: radius.lg,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: space[1.5],
      opacity: buttonOpacity(disabled, state.pressed),
      backgroundColor: variant === "ghost" ? hoverFill(theme, state as PressState) : fill,
    }),
    [disabled, fill, theme, variant],
  );
  const labelStyle = useMemo(() => ({ color: text, fontSize: font.base }), [text]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      disabled={disabled}
      onPress={props.onPress}
      testID={props.testID}
      style={style}
    >
      {props.icon ? <Icon name={props.icon} size={15} color={text} /> : null}
      <Text style={labelStyle}>{props.label}</Text>
    </Pressable>
  );
}

interface SegmentOption<Value extends string> {
  value: Value;
  label: string;
  icon: string;
}

function Segment<Value extends string>(props: {
  theme: PluginTheme;
  option: SegmentOption<Value>;
  selected: boolean;
  onChange(value: Value): void;
}) {
  const { option, onChange, selected } = props;
  const colors = props.theme.colors;
  const press = useCallback(() => onChange(option.value), [onChange, option.value]);
  const styles = useMemo(
    () => ({
      segment: {
        height: 24,
        paddingHorizontal: space[2],
        borderRadius: radius.md,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: space[1],
        backgroundColor: selected ? colors.surface2 : "transparent",
      },
      label: { fontSize: font.sm, color: selected ? colors.foreground : colors.foregroundMuted },
    }),
    [colors, selected],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={option.label}
      accessibilityState={selected ? SELECTED : UNSELECTED}
      onPress={press}
      style={styles.segment}
      testID={`notes-mode-${option.value}`}
    >
      <Icon
        name={option.icon}
        size={13}
        color={selected ? colors.foreground : colors.foregroundMuted}
      />
      <Text style={styles.label}>{option.label}</Text>
    </Pressable>
  );
}

export function Segmented<Value extends string>(props: {
  theme: PluginTheme;
  value: Value;
  options: ReadonlyArray<SegmentOption<Value>>;
  onChange(value: Value): void;
}) {
  const colors = props.theme.colors;
  const frame = useMemo(
    () => ({
      flexDirection: "row" as const,
      padding: 2,
      gap: 2,
      borderRadius: radius.lg,
      backgroundColor: colors.surface1,
      borderWidth: 1,
      borderColor: colors.border,
    }),
    [colors],
  );
  return (
    <View style={frame}>
      {props.options.map((option) => (
        <Segment
          key={option.value}
          theme={props.theme}
          option={option}
          selected={option.value === props.value}
          onChange={props.onChange}
        />
      ))}
    </View>
  );
}

const confirmActions: ViewStyle = {
  flexDirection: "row",
  justifyContent: "flex-end",
  gap: space[2],
};

export function ConfirmModal(props: {
  theme: PluginTheme;
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm(): void;
  onClose(): void;
}) {
  const { onClose } = props;
  const onOpenChange = useCallback((open: boolean) => !open && onClose(), [onClose]);
  const messageStyle = useMemo(
    () => ({ color: props.theme.colors.foreground, fontSize: font.base, lineHeight: 21 }),
    [props.theme],
  );
  return (
    <Modal title={props.title} open={props.open} onOpenChange={onOpenChange}>
      <Modal.Content>
        <Text style={messageStyle}>{props.message}</Text>
        <View style={confirmActions}>
          <TextButton theme={props.theme} label="Cancel" variant="secondary" onPress={onClose} />
          <TextButton
            theme={props.theme}
            label={props.confirmLabel}
            variant="destructive"
            onPress={props.onConfirm}
            testID="notes-confirm"
          />
        </View>
      </Modal.Content>
    </Modal>
  );
}

const sectionLabelRow: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  paddingHorizontal: space[4],
  marginTop: space[4],
  marginBottom: space[1],
  minHeight: 30,
};

export function SectionLabel(props: {
  theme: PluginTheme;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  const labelStyle = useMemo(
    () => ({
      color: props.theme.colors.foregroundMuted,
      fontSize: font.sm,
      fontWeight: "500" as const,
    }),
    [props.theme],
  );
  return (
    <View style={sectionLabelRow}>
      <Text style={labelStyle}>{props.children}</Text>
      {props.trailing}
    </View>
  );
}
