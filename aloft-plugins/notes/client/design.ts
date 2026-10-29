import type { PluginTheme } from "@getpaseo/plugin";
import { Platform } from "react-native";

// Mirrors the host design tokens in packages/app/src/styles/theme.ts so Notes sits on the same
// rhythm as the rest of Aloft: 4px spacing steps, a 14px interface base, 15px reading content.

export const space = { half: 2, 1: 4, 1.5: 6, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32, 12: 48 } as const;
export const font = { sm: 12, base: 14, content: 15, lg: 16, xl: 18, title: 24 } as const;
export const radius = { base: 4, md: 6, lg: 8, xl: 12 } as const;
export const MONO_FONT =
  "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

export const SIDEBAR_WIDTH = 232;
export const LIST_WIDTH = 300;
/** Readable line length for the editor and reading view, as in Obsidian's default. */
export const READING_WIDTH = 760;

/** Mixes a theme colour with transparency; CSS on web, a fallback colour on native. */
export function translucent(color: string, percent: number, fallback: string): string {
  if (Platform.OS !== "web") return fallback;
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

export function selectionFill(theme: PluginTheme): string {
  return translucent(theme.colors.accent, 14, theme.colors.surface2);
}
