import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { Annotation, EditorSelection, EditorState } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { forwardRef } from 'preact/compat';
import { useEffect, useImperativeHandle, useRef } from 'preact/hooks';
import { useI18n } from '../../i18n';
import { fileToMarkdownImage } from '../../markdown/imageDataUri';
import type { ThemeMode } from '../../renderers/mermaidRenderer';
import { createBase64FoldExtension, type Base64FoldLabels } from './base64FoldExtension';

export const ExternalSyncAnnotation = Annotation.define<boolean>();

export interface RawEditorHandle {
  focus: () => void;
  scrollToLine: (line: number) => void;
  setScrollRatio: (ratio: number) => void;
  insertSnippet: (snippet: string) => void;
  wrapSelection: (before: string, after?: string) => void;
  openSearch: () => void;
}

interface RawEditorProps {
  docKey: string;
  markdown: string;
  theme: ThemeMode;
  onChange: (nextMarkdown: string) => void;
  onCursorChange?: (pos: { line: number; col: number }) => void;
  onScrollRatio?: (ratio: number) => void;
  onSaveShortcut?: () => void;
}

const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, color: 'var(--md-h1)', fontWeight: '700', fontSize: '1.24em' },
  { tag: tags.heading2, color: 'var(--md-h2)', fontWeight: '700', fontSize: '1.14em' },
  { tag: tags.heading3, color: 'var(--md-h3)', fontWeight: '650', fontSize: '1.06em' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], color: 'var(--md-h3)', fontWeight: '600' },
  { tag: tags.strong, fontWeight: '700', color: 'var(--text-primary)' },
  { tag: tags.emphasis, fontStyle: 'italic', color: 'var(--text-primary)' },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--text-muted)' },
  { tag: tags.link, color: 'var(--accent)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--accent)' },
  { tag: tags.monospace, color: 'var(--code-fg)', backgroundColor: 'var(--code-inline-bg)', borderRadius: '3px' },
  { tag: tags.quote, color: 'var(--text-secondary)', fontStyle: 'italic' },
  { tag: tags.meta, color: 'var(--text-muted)' },
  { tag: tags.comment, color: 'var(--text-muted)' },
  { tag: tags.keyword, color: 'var(--syntax-keyword)' },
  { tag: tags.string, color: 'var(--syntax-string)' },
  { tag: tags.number, color: 'var(--syntax-number)' },
  { tag: tags.operator, color: 'var(--syntax-operator)' },
  { tag: tags.processingInstruction, color: 'var(--accent)' },
]);

function computeMinimalDiff(oldText: string, newText: string): { from: number; to: number; insert: string } {
  if (oldText === newText) {
    return { from: 0, to: 0, insert: '' };
  }
  let start = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (start < minLen && oldText.charCodeAt(start) === newText.charCodeAt(start)) {
    start += 1;
  }
  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    oldText.charCodeAt(oldEnd - 1) === newText.charCodeAt(newEnd - 1)
  ) {
    oldEnd -= 1;
    newEnd -= 1;
  }
  return {
    from: start,
    to: oldEnd,
    insert: newText.slice(start, newEnd),
  };
}

function toggleMarkdownWrap(view: EditorView, before: string, after = before): boolean {
  const { state } = view;
  const range = state.selection.main;
  const selected = state.sliceDoc(range.from, range.to);
  if (selected.startsWith(before) && selected.endsWith(after) && selected.length >= before.length + after.length) {
    const unwrapped = selected.slice(before.length, selected.length - after.length);
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: unwrapped },
      selection: EditorSelection.range(range.from, range.from + unwrapped.length),
    });
  } else {
    const insert = `${before}${selected}${after}`;
    view.dispatch({
      changes: { from: range.from, to: range.to, insert },
      selection: selected.length > 0
        ? EditorSelection.range(range.from + before.length, range.from + before.length + selected.length)
        : EditorSelection.cursor(range.from + before.length),
    });
  }
  return true;
}

export const RawEditor = forwardRef<RawEditorHandle, RawEditorProps>(function RawEditor(
  { docKey, markdown: markdownText, onChange, onCursorChange, onScrollRatio, onSaveShortcut },
  ref,
) {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const latestMarkdownRef = useRef(markdownText);
  const suppressScrollRef = useRef(false);

  const callbacksRef = useRef({ onChange, onCursorChange, onScrollRatio, onSaveShortcut });
  callbacksRef.current = { onChange, onCursorChange, onScrollRatio, onSaveShortcut };

  const labelsRef = useRef<Base64FoldLabels>(t.base64);
  labelsRef.current = t.base64;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const handleImageFiles = async (files: FileList | null | undefined, pos?: number) => {
      const view = viewRef.current;
      if (!view || !files || files.length === 0) return false;

      const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (imageFiles.length === 0) return false;

      const snippets: string[] = [];
      for (const file of imageFiles) {
        const res = await fileToMarkdownImage(file);
        snippets.push(res.markdown);
      }
      const insertText = snippets.join('\n');
      const targetPos = pos ?? view.state.selection.main.from;
      view.dispatch({
        changes: { from: targetPos, to: pos ?? view.state.selection.main.to, insert: insertText },
        selection: EditorSelection.cursor(targetPos + insertText.length),
      });
      return true;
    };

    const cmTheme = EditorView.theme({
      '&': {
        height: '100%',
        backgroundColor: 'var(--bg-editor)',
        color: 'var(--text-primary)',
        fontSize: '14px',
      },
      '.cm-scroller': {
        fontFamily: 'var(--font-mono)',
        lineHeight: '1.65',
        overflow: 'auto',
      },
      '.cm-content': {
        padding: '20px 18px 48px 12px',
        caretColor: 'var(--accent)',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--bg-editor)',
        color: 'var(--text-muted)',
        borderRight: '1px solid var(--border-subtle)',
        userSelect: 'none',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'var(--bg-hover)',
        color: 'var(--text-primary)',
      },
      '.cm-activeLine': {
        backgroundColor: 'var(--bg-active-line)',
      },
      '&.cm-focused .cm-selectionBackground, ::selection': {
        backgroundColor: 'var(--selection-bg)',
      },
      '.cm-cursor': {
        borderLeftColor: 'var(--accent)',
        borderLeftWidth: '2px',
      },
    });

    const state = EditorState.create({
      doc: markdownText,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        bracketMatching(),
        highlightSelectionMatches(),
        search({ top: true }),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        syntaxHighlighting(markdownHighlightStyle),
        createBase64FoldExtension(() => labelsRef.current),
        cmTheme,
        keymap.of([
          {
            key: 'Mod-b',
            run: (view) => toggleMarkdownWrap(view, '**'),
          },
          {
            key: 'Mod-i',
            run: (view) => toggleMarkdownWrap(view, '*'),
          },
          {
            key: 'Mod-k',
            run: (view) => {
              const sel = view.state.selection.main;
              const selected = view.state.sliceDoc(sel.from, sel.to) || 'enlace';
              const insert = `[${selected}](https://)`;
              view.dispatch({
                changes: { from: sel.from, to: sel.to, insert },
                selection: EditorSelection.cursor(sel.from + selected.length + 11),
              });
              return true;
            },
          },
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              callbacksRef.current.onSaveShortcut?.();
              return true;
            },
          },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
        ]),
        EditorView.domEventHandlers({
          paste(event) {
            const files = event.clipboardData?.files;
            if (files && Array.from(files).some((f) => f.type.startsWith('image/'))) {
              event.preventDefault();
              void handleImageFiles(files);
              return true;
            }
            return false;
          },
          drop(event, view) {
            const files = event.dataTransfer?.files;
            if (files && Array.from(files).some((f) => f.type.startsWith('image/'))) {
              event.preventDefault();
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.from;
              void handleImageFiles(files, pos);
              return true;
            }
            return false;
          },
          scroll(_event, view) {
            if (suppressScrollRef.current) return;
            const scroller = view.scrollDOM;
            const max = scroller.scrollHeight - scroller.clientHeight;
            if (max > 0) {
              callbacksRef.current.onScrollRatio?.(scroller.scrollTop / max);
            }
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.selectionSet || update.docChanged) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            callbacksRef.current.onCursorChange?.({
              line: line.number,
              col: head - line.from + 1,
            });
          }

          if (update.docChanged) {
            const isExternal = update.transactions.some((tr) => tr.annotation(ExternalSyncAnnotation));
            const nextDoc = update.state.doc.toString();
            latestMarkdownRef.current = nextDoc;
            if (!isExternal) {
              callbacksRef.current.onChange(nextDoc);
            }
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    latestMarkdownRef.current = markdownText;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [docKey]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === markdownText) return;

    const diff = computeMinimalDiff(current, markdownText);
    if (diff.from === diff.to && diff.insert.length === 0) return;

    latestMarkdownRef.current = markdownText;
    view.dispatch({
      changes: diff,
      annotations: ExternalSyncAnnotation.of(true),
    });
  }, [markdownText]);

  useImperativeHandle(ref, () => ({
    focus() {
      viewRef.current?.focus();
    },
    scrollToLine(lineNumber: number) {
      const view = viewRef.current;
      if (!view) return;
      const clamped = Math.min(view.state.doc.lines, Math.max(1, lineNumber));
      const line = view.state.doc.line(clamped);
      view.dispatch({
        selection: EditorSelection.cursor(line.from),
        effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 24 }),
      });
    },
    setScrollRatio(ratio: number) {
      const view = viewRef.current;
      if (!view) return;
      const scroller = view.scrollDOM;
      const max = scroller.scrollHeight - scroller.clientHeight;
      if (max <= 0) return;
      suppressScrollRef.current = true;
      scroller.scrollTop = Math.max(0, Math.min(max, ratio * max));
      requestAnimationFrame(() => {
        suppressScrollRef.current = false;
      });
    },
    insertSnippet(snippet: string) {
      const view = viewRef.current;
      if (!view) return;
      const sel = view.state.selection.main;
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: snippet },
        selection: EditorSelection.cursor(sel.from + snippet.length),
      });
      view.focus();
    },
    wrapSelection(before: string, after?: string) {
      const view = viewRef.current;
      if (!view) return;
      toggleMarkdownWrap(view, before, after ?? before);
      view.focus();
    },
    openSearch() {
      const view = viewRef.current;
      if (!view) return;
      openSearchPanel(view);
    },
  }));

  return <div ref={hostRef} className="raw-editor-host" data-testid="raw-editor" />;
});
