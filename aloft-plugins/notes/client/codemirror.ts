import type { PluginTheme } from "@getpaseo/plugin";
import type { EditorView as EditorViewType, EditorViewConfig, ViewUpdate } from "@codemirror/view";
import { Platform } from "react-native";
import { MONO_FONT, READING_WIDTH, font, translucent } from "./design";

export type FormatAction =
  | "bold"
  | "italic"
  | "strike"
  | "heading"
  | "bullet"
  | "task"
  | "link"
  | "code";

export interface NoteEditorHandle {
  /** Replaces the text without reporting it as an edit. */
  setText(text: string): void;
  focus(): void;
  format(action: FormatAction): void;
  destroy(): void;
}

export interface NoteEditorOptions {
  text: string;
  theme: PluginTheme;
  placeholder: string;
  /** Horizontal inset in px; matches the title above the editor. */
  gutter: number;
  onChange(text: string): void;
  onOpenLink(target: string): void;
  /** Read at completion time so suggestions follow the live vault. */
  getTitles(): string[];
  getTags(): string[];
}

// Plugin code compiles without the DOM library; these are the few DOM calls the editor makes.
interface DomElement {
  className: string;
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, listener: (event: { preventDefault(): void }) => void): void;
}
interface DomOwner {
  ownerDocument: { createElement(tag: string): DomElement };
}

const WIKILINK = /\[\[([^\]\n]+?)\]\]/g;
const TAG = /(?<=^|[\s(,;])#[\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*/gu;
const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

/** DOM code stays here; native never evaluates the editor dependencies. */
export function mountNoteEditor(
  parent: unknown,
  options: NoteEditorOptions,
): NoteEditorHandle | null {
  if (Platform.OS !== "web" || !parent) return null;
  const { EditorState, EditorSelection, Transaction } =
    require("@codemirror/state") as typeof import("@codemirror/state");
  const view = require("@codemirror/view") as typeof import("@codemirror/view");
  const {
    EditorView,
    Decoration,
    MatchDecorator,
    ViewPlugin,
    WidgetType,
    keymap,
    placeholder,
    drawSelection,
  } = view;
  const { defaultKeymap, history, historyKeymap, indentWithTab } =
    require("@codemirror/commands") as typeof import("@codemirror/commands");
  const { markdown, markdownLanguage, markdownKeymap } =
    require("@codemirror/lang-markdown") as typeof import("@codemirror/lang-markdown");
  const { HighlightStyle, syntaxHighlighting, indentUnit } =
    require("@codemirror/language") as typeof import("@codemirror/language");
  const { tags } = require("@lezer/highlight") as typeof import("@lezer/highlight");
  const { autocompletion, closeBrackets, closeBracketsKeymap } =
    require("@codemirror/autocomplete") as typeof import("@codemirror/autocomplete");
  type CompletionContext = import("@codemirror/autocomplete").CompletionContext;

  const colors = options.theme.colors;
  const muted = colors.foregroundMuted;

  const highlight = HighlightStyle.define([
    { tag: tags.heading1, fontSize: "1.6em", fontWeight: "650", lineHeight: "1.3" },
    { tag: tags.heading2, fontSize: "1.35em", fontWeight: "650", lineHeight: "1.3" },
    { tag: tags.heading3, fontSize: "1.15em", fontWeight: "650" },
    { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: "650" },
    { tag: tags.strong, fontWeight: "650" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strikethrough, textDecoration: "line-through", color: muted },
    { tag: [tags.link, tags.url], color: colors.accent },
    { tag: tags.monospace, fontFamily: MONO_FONT, fontSize: "0.9em" },
    { tag: tags.quote, color: muted, fontStyle: "italic" },
    { tag: [tags.processingInstruction, tags.contentSeparator], color: muted, opacity: "0.6" },
    { tag: tags.meta, color: muted },
  ]);

  const linkDecorator = new MatchDecorator({
    regexp: WIKILINK,
    decoration: () => Decoration.mark({ class: "cm-wikilink" }),
  });
  const tagDecorator = new MatchDecorator({
    regexp: TAG,
    decoration: () => Decoration.mark({ class: "cm-hashtag" }),
  });
  const decorate = (decorator: InstanceType<typeof MatchDecorator>) =>
    ViewPlugin.fromClass(
      class {
        decorations;
        constructor(editor: EditorViewType) {
          this.decorations = decorator.createDeco(editor);
        }
        update(update: ViewUpdate) {
          this.decorations = decorator.updateDeco(update, this.decorations);
        }
      },
      { decorations: (plugin) => plugin.decorations },
    );

  // Front matter is metadata: render it small and muted, the way Obsidian folds properties away.
  const frontmatter = ViewPlugin.fromClass(
    class {
      decorations;
      constructor(editor: EditorViewType) {
        this.decorations = this.build(editor);
      }
      update(update: ViewUpdate) {
        if (update.docChanged) this.decorations = this.build(update.view);
      }
      build(editor: EditorViewType) {
        const doc = editor.state.doc;
        if (doc.lines < 2 || doc.line(1).text !== "---") return Decoration.none;
        let end = -1;
        for (let line = 2; line <= Math.min(doc.lines, 200); line += 1) {
          if (doc.line(line).text.trimEnd() === "---") {
            end = line;
            break;
          }
        }
        if (end < 0) return Decoration.none;
        const marks = [];
        for (let line = 1; line <= end; line += 1) {
          marks.push(Decoration.line({ class: "cm-frontmatter" }).range(doc.line(line).from));
        }
        return Decoration.set(marks);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );

  function toggleTask(editor: EditorViewType, markFrom: number) {
    const current = editor.state.sliceDoc(markFrom, markFrom + 1);
    editor.dispatch({
      changes: { from: markFrom, to: markFrom + 1, insert: current === " " ? "x" : " " },
    });
  }

  // Task boxes render as real checkboxes, as in Obsidian's live preview. The line holding the
  // cursor shows the raw "[ ]" so it stays editable; completed items fade.
  class CheckboxWidget extends WidgetType {
    constructor(
      readonly checked: boolean,
      readonly markFrom: number,
    ) {
      super();
    }
    eq(other: CheckboxWidget) {
      return other.checked === this.checked && other.markFrom === this.markFrom;
    }
    toDOM(editor: EditorViewType) {
      const box = (editor.dom as unknown as DomOwner).ownerDocument.createElement("span");
      box.className = this.checked ? "cm-task-box cm-task-box-checked" : "cm-task-box";
      box.setAttribute("role", "checkbox");
      box.setAttribute("aria-checked", String(this.checked));
      box.textContent = this.checked ? "✓" : "";
      box.addEventListener("mousedown", (event) => {
        event.preventDefault();
        toggleTask(editor, this.markFrom);
      });
      return box as unknown as HTMLElement;
    }
    ignoreEvent() {
      return false;
    }
  }

  const taskBoxes = ViewPlugin.fromClass(
    class {
      decorations;
      constructor(editor: EditorViewType) {
        this.decorations = this.build(editor);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = this.build(update.view);
        }
      }
      build(editor: EditorViewType) {
        const ranges = [];
        const cursorLines = new Set(
          editor.state.selection.ranges.map((range) => editor.state.doc.lineAt(range.head).number),
        );
        for (const { from, to } of editor.visibleRanges) {
          for (let pos = from; pos <= to; ) {
            const line = editor.state.doc.lineAt(pos);
            const task = TASK.exec(line.text);
            if (task && !cursorLines.has(line.number)) {
              const boxFrom = line.from + task[1].length - 1;
              const checked = task[2] !== " ";
              ranges.push(
                Decoration.replace({ widget: new CheckboxWidget(checked, boxFrom + 1) }).range(
                  boxFrom,
                  boxFrom + 3,
                ),
              );
              if (checked && line.to > boxFrom + 3) {
                ranges.push(Decoration.mark({ class: "cm-task-done" }).range(boxFrom + 3, line.to));
              }
            }
            pos = line.to + 1;
          }
        }
        return Decoration.set(ranges, true);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );

  function linkAt(editor: EditorViewType, position: number): string | null {
    const line = editor.state.doc.lineAt(position);
    for (const match of line.text.matchAll(WIKILINK)) {
      const start = line.from + (match.index ?? 0);
      if (position >= start && position <= start + match[0].length) {
        const inner = match[1];
        const pipe = inner.indexOf("|");
        const destination = pipe >= 0 ? inner.slice(0, pipe) : inner;
        const hash = destination.search(/[#^]/);
        return (hash >= 0 ? destination.slice(0, hash) : destination).trim();
      }
    }
    return null;
  }

  const clicks = EditorView.domEventHandlers({
    mousedown(event, editor) {
      const position = editor.posAtCoords({ x: event.clientX, y: event.clientY });
      if (position === null) return false;
      if (event.metaKey || event.ctrlKey) {
        const target = linkAt(editor, position);
        if (!target) return false;
        event.preventDefault();
        options.onOpenLink(target);
        return true;
      }
      const line = editor.state.doc.lineAt(position);
      const task = TASK.exec(line.text);
      if (!task) return false;
      const boxFrom = line.from + task[1].length - 1;
      if (position < boxFrom || position > boxFrom + 3) return false;
      event.preventDefault();
      const checked = task[2] !== " ";
      editor.dispatch({
        changes: {
          from: line.from + task[1].length,
          to: line.from + task[1].length + 1,
          insert: checked ? " " : "x",
        },
      });
      return true;
    },
  });

  function linkCompletions(context: CompletionContext) {
    const before = context.matchBefore(/\[\[[^\]\n|#]*/);
    if (!before) return null;
    const query = before.text.slice(2).toLowerCase();
    const titles = options.getTitles();
    const ranked = titles
      .filter((title) => title.toLowerCase().includes(query))
      .sort(
        (a, b) =>
          Number(!a.toLowerCase().startsWith(query)) - Number(!b.toLowerCase().startsWith(query)),
      )
      .slice(0, 50);
    return {
      from: before.from + 2,
      filter: false,
      options: ranked.map((title) => ({
        label: title,
        type: "text",
        apply(editor: EditorViewType, _completion: unknown, from: number, to: number) {
          const closed = editor.state.sliceDoc(to, to + 2) === "]]";
          const insert = closed ? title : `${title}]]`;
          editor.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + title.length + 2 },
          });
        },
      })),
    };
  }

  function tagCompletions(context: CompletionContext) {
    const before = context.matchBefore(/(?:^|[\s(])#[\p{L}\p{N}_\-/]*/u);
    if (!before) return null;
    const hash = before.text.indexOf("#");
    const query = before.text.slice(hash + 1).toLowerCase();
    if (query.length === 0 && !context.explicit) return null;
    return {
      from: before.from + hash + 1,
      options: options
        .getTags()
        .filter((tag) => tag.toLowerCase().startsWith(query))
        .map((tag) => ({ label: tag, type: "keyword" })),
    };
  }

  function wrap(editor: EditorViewType, marker: string, empty = "") {
    editor.dispatch(
      editor.state.changeByRange((range) => {
        const selected = editor.state.sliceDoc(range.from, range.to) || empty;
        const insert = `${marker}${selected}${marker}`;
        return {
          changes: { from: range.from, to: range.to, insert },
          range: EditorSelection.range(
            range.from + marker.length,
            range.from + marker.length + selected.length,
          ),
        };
      }),
    );
  }

  function prefixLines(editor: EditorViewType, prefix: string, pattern: RegExp) {
    const changes = [];
    const seen = new Set<number>();
    for (const range of editor.state.selection.ranges) {
      for (let pos = range.from; pos <= range.to; ) {
        const line = editor.state.doc.lineAt(pos);
        if (!seen.has(line.number)) {
          seen.add(line.number);
          const existing = pattern.exec(line.text);
          changes.push(
            existing
              ? { from: line.from, to: line.from + existing[0].length, insert: "" }
              : { from: line.from, insert: prefix },
          );
        }
        pos = line.to + 1;
      }
    }
    editor.dispatch({ changes });
  }

  let applyingHostText = false;
  const editor: EditorViewType = new EditorView({
    parent: parent as EditorViewConfig["parent"],
    state: EditorState.create({
      doc: options.text,
      extensions: [
        EditorState.lineSeparator.of(options.text.includes("\r\n") ? "\r\n" : "\n"),
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(highlight),
        decorate(linkDecorator),
        decorate(tagDecorator),
        frontmatter,
        taskBoxes,
        history(),
        drawSelection(),
        closeBrackets(),
        indentUnit.of("    "),
        autocompletion({ override: [linkCompletions, tagCompletions], icons: false }),
        keymap.of([
          ...closeBracketsKeymap,
          ...markdownKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
          { key: "Mod-i", run: (target) => (wrap(target, "*"), true) },
        ]),
        placeholder(options.placeholder),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ "aria-label": "Note editor", spellcheck: "true" }),
        clicks,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applyingHostText) {
            options.onChange(update.state.doc.toString());
          }
        }),
        EditorView.theme(
          {
            "&": {
              height: "100%",
              color: colors.foreground,
              backgroundColor: "transparent",
              fontSize: `${font.content}px`,
            },
            "&.cm-focused": { outline: "none" },
            ".cm-scroller": {
              overflow: "auto",
              fontFamily: "inherit",
              lineHeight: "1.65",
            },
            ".cm-content": {
              maxWidth: `${READING_WIDTH}px`,
              margin: "0 auto",
              padding: `8px ${options.gutter}px 160px`,
              caretColor: colors.accent,
            },
            ".cm-line": { padding: "0" },
            ".cm-cursor, .cm-dropCursor": {
              borderLeftColor: colors.accent,
              borderLeftWidth: "2px",
            },
            "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection":
              { backgroundColor: translucent(colors.accent, 22, colors.surface2) },
            ".cm-placeholder": { color: muted },
            ".cm-wikilink": {
              color: colors.accent,
              textDecoration: "underline",
              textDecorationColor: translucent(colors.accent, 40, colors.accent),
              textUnderlineOffset: "3px",
              cursor: "pointer",
            },
            ".cm-hashtag": {
              color: colors.accent,
              backgroundColor: translucent(colors.accent, 10, "transparent"),
              borderRadius: "4px",
              padding: "1px 3px",
            },
            ".cm-task-box": {
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "15px",
              height: "15px",
              marginRight: "6px",
              verticalAlign: "-2px",
              borderRadius: "4px",
              border: `1.5px solid ${muted}`,
              color: colors.accentForeground,
              fontSize: "11px",
              fontWeight: "700",
              lineHeight: "1",
              cursor: "pointer",
              boxSizing: "border-box",
            },
            ".cm-task-box-checked": {
              backgroundColor: colors.accent,
              borderColor: colors.accent,
            },
            ".cm-task-done": { color: muted, textDecoration: "line-through" },
            ".cm-frontmatter": {
              color: muted,
              fontFamily: MONO_FONT,
              fontSize: "0.82em",
            },
            ".cm-tooltip": {
              backgroundColor: colors.surface1,
              border: `1px solid ${colors.border}`,
              borderRadius: "8px",
              overflow: "hidden",
              boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            },
            ".cm-tooltip-autocomplete > ul": { fontFamily: "inherit", maxHeight: "16em" },
            ".cm-tooltip-autocomplete > ul > li": {
              padding: "6px 12px !important",
              color: colors.foreground,
            },
            ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
              backgroundColor: translucent(colors.accent, 18, colors.surface2),
              color: colors.foreground,
            },
            ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "650" },
          },
          { dark: false },
        ),
      ],
    }),
  });

  return {
    setText(next) {
      if (editor.state.doc.toString() === next) return;
      applyingHostText = true;
      try {
        // Text from disk stays out of undo history, so Cmd+Z never reverts another app's edit.
        editor.dispatch({
          changes: { from: 0, to: editor.state.doc.length, insert: next },
          annotations: Transaction.addToHistory.of(false),
        });
      } finally {
        applyingHostText = false;
      }
    },
    focus() {
      editor.focus();
    },
    format(action) {
      switch (action) {
        case "bold":
          wrap(editor, "**");
          break;
        case "italic":
          wrap(editor, "*");
          break;
        case "strike":
          wrap(editor, "~~");
          break;
        case "code":
          wrap(editor, "`");
          break;
        case "heading":
          prefixLines(editor, "## ", /^#{1,6}\s+/);
          break;
        case "bullet":
          prefixLines(editor, "- ", /^\s*[-*+]\s+(?!\[)/);
          break;
        case "task":
          prefixLines(editor, "- [ ] ", /^\s*[-*+]\s+\[[ xX]\]\s+/);
          break;
        case "link": {
          const range = editor.state.selection.main;
          const selected = editor.state.sliceDoc(range.from, range.to);
          editor.dispatch({
            changes: { from: range.from, to: range.to, insert: `[[${selected}]]` },
            selection: { anchor: range.from + 2 + selected.length },
          });
          break;
        }
      }
      editor.focus();
    },
    destroy() {
      editor.destroy();
    },
  };
}
