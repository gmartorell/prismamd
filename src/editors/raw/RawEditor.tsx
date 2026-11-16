import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import {
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
  searchPanelOpen,
} from '@codemirror/search';
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  Transaction,
} from '@codemirror/state';
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
import {
  createBase64FoldExtension,
  createBase64LabelsExtension,
} from './base64FoldExtension';

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

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

export function computeMinimalDiff(
  oldText: string,
  newText: string,
): { from: number; to: number; insert: string } {
  if (oldText === newText) {
    return { from: 0, to: 0, insert: '' };
  }
  let start = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (start < minLen && oldText.charCodeAt(start) === newText.charCodeAt(start)) {
    start += 1;
  }
  // Never split a UTF-16 surrogate pair at the leading boundary
  if (start > 0 && isHighSurrogate(oldText.charCodeAt(start - 1))) {
    start -= 1;
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
  // Never split a UTF-16 surrogate pair at the trailing boundary
  if (oldEnd < oldText.length && newEnd < newText.length && isLowSurrogate(oldText.charCodeAt(oldEnd))) {
    oldEnd += 1;
    newEnd += 1;
  }

  return {
    from: start,
    to: oldEnd,
    insert: newText.slice(start, newEnd),
  };
}

function countOuterAsterisks(state: EditorState, from: number, to: number): number {
  let left = 0;
  while (left < 3 && from - 1 - left >= 0 && state.sliceDoc(from - 1 - left, from - left) === '*') {
    left += 1;
  }
  let right = 0;
  while (
    right < 3 &&
    to + right < state.doc.length &&
    state.sliceDoc(to + right, to + 1 + right) === '*'
  ) {
    right += 1;
  }
  return Math.min(left, right);
}

function countInnerAsterisks(selected: string): number {
  let lead = 0;
  while (lead < 3 && lead < selected.length && selected[lead] === '*') {
    lead += 1;
  }
  let trail = 0;
  while (trail < 3 && trail < selected.length && selected[selected.length - 1 - trail] === '*') {
    trail += 1;
  }
  const paired = Math.min(lead, trail);
  return selected.length >= paired * 2 ? paired : 0;
}

export function toggleMarkdownWrap(view: EditorView, before: string, after = before): boolean {
  const { state } = view;
  const range = state.selection.main;
  const selected = state.sliceDoc(range.from, range.to);

  if ((before === '*' && after === '*') || (before === '**' && after === '**')) {
    const markerLen = before.length; // 1 for italic `*`, 2 for bold `**`
    const outerStars = countOuterAsterisks(state, range.from, range.to);
    const innerStars = outerStars === 0 ? countInnerAsterisks(selected) : 0;

    const hasOuterFormat =
      markerLen === 1 ? outerStars === 1 || outerStars === 3 : outerStars >= 2;
    const hasInnerFormat =
      markerLen === 1 ? innerStars === 1 || innerStars === 3 : innerStars >= 2;

    if (hasOuterFormat) {
      view.dispatch({
        changes: [
          { from: range.from - markerLen, to: range.from, insert: '' },
          { from: range.to, to: range.to + markerLen, insert: '' },
        ],
        selection:
          range.from === range.to
            ? EditorSelection.cursor(range.from - markerLen)
            : EditorSelection.range(range.from - markerLen, range.to - markerLen),
      });
      return true;
    }

    if (hasInnerFormat) {
      const unwrapped = selected.slice(markerLen, selected.length - markerLen);
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: unwrapped },
        selection:
          unwrapped.length > 0
            ? EditorSelection.range(range.from, range.from + unwrapped.length)
            : EditorSelection.cursor(range.from),
      });
      return true;
    }

    const insert = `${before}${selected}${after}`;
    view.dispatch({
      changes: { from: range.from, to: range.to, insert },
      selection:
        selected.length > 0
          ? EditorSelection.range(
              range.from + markerLen,
              range.from + markerLen + selected.length,
            )
          : EditorSelection.cursor(range.from + markerLen),
    });
    return true;
  }

  // Generic delimiter pair (`backtick`, `$`, `~~`, etc.)
  const hasSurroundingWrap =
    range.from >= before.length &&
    range.to + after.length <= state.doc.length &&
    state.sliceDoc(range.from - before.length, range.from) === before &&
    state.sliceDoc(range.to, range.to + after.length) === after;

  if (hasSurroundingWrap) {
    view.dispatch({
      changes: [
        { from: range.from - before.length, to: range.from, insert: '' },
        { from: range.to, to: range.to + after.length, insert: '' },
      ],
      selection:
        range.from === range.to
          ? EditorSelection.cursor(range.from - before.length)
          : EditorSelection.range(range.from - before.length, range.to - before.length),
    });
    return true;
  }

  if (
    selected.startsWith(before) &&
    selected.endsWith(after) &&
    selected.length >= before.length + after.length
  ) {
    const unwrapped = selected.slice(before.length, selected.length - after.length);
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: unwrapped },
      selection:
        unwrapped.length > 0
          ? EditorSelection.range(range.from, range.from + unwrapped.length)
          : EditorSelection.cursor(range.from),
    });
    return true;
  }

  const insert = `${before}${selected}${after}`;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection:
      selected.length > 0
        ? EditorSelection.range(range.from + before.length, range.from + before.length + selected.length)
        : EditorSelection.cursor(range.from + before.length),
  });
  return true;
}

export const RawEditor = forwardRef<RawEditorHandle, RawEditorProps>(function RawEditor(
  { docKey, markdown: markdownText, onChange, onCursorChange, onScrollRatio, onSaveShortcut },
  ref,
) {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const labelsCompartmentRef = useRef<Compartment>(new Compartment());
  const latestMarkdownRef = useRef(markdownText);
  const suppressScrollRef = useRef(false);

  const callbacksRef = useRef({ onChange, onCursorChange, onScrollRatio, onSaveShortcut });
  callbacksRef.current = { onChange, onCursorChange, onScrollRatio, onSaveShortcut };

  const i18nRef = useRef(t);
  i18nRef.current = t;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let destroyed = false;
    const labelsCompartment = new Compartment();
    labelsCompartmentRef.current = labelsCompartment;

    const handleImageFiles = async (
      targetView: EditorView,
      files: FileList | null | undefined,
      pos?: number,
    ) => {
      if (destroyed || !files || files.length === 0) return false;

      const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (imageFiles.length === 0) return false;

      const snippets: string[] = [];
      const fallbackAlt = i18nRef.current.toolbar.defaultImageAlt;
      for (const file of imageFiles) {
        try {
          const res = await fileToMarkdownImage(file, fallbackAlt);
          snippets.push(res.markdown);
        } catch {
          // Ignore unreadable image file without throwing unhandled rejection
        }
      }
      if (snippets.length === 0) return false;

      const activeView = viewRef.current;
      if (destroyed || !activeView || activeView !== targetView) return false;

      const insertText = snippets.join('\n');
      const docLen = activeView.state.doc.length;
      const from =
        typeof pos === 'number'
          ? Math.max(0, Math.min(docLen, pos))
          : activeView.state.selection.main.from;
      const to =
        typeof pos === 'number'
          ? from
          : activeView.state.selection.main.to;

      activeView.dispatch({
        changes: { from, to, insert: insertText },
        selection: EditorSelection.cursor(from + insertText.length),
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

    const initialLabels = i18nRef.current.base64;
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
        createBase64FoldExtension(initialLabels),
        labelsCompartment.of(createBase64LabelsExtension(initialLabels)),
        cmTheme,
        Prec.high(
          EditorView.domEventHandlers({
            keydown(event) {
              if (
                (event.ctrlKey || event.metaKey) &&
                !event.shiftKey &&
                !event.altKey &&
                event.key.toLowerCase() === 's'
              ) {
                event.preventDefault();
                event.stopPropagation();
                callbacksRef.current.onSaveShortcut?.();
                return true;
              }
              return false;
            },
          }),
        ),
        EditorView.domEventHandlers({
          paste(event, view) {
            const files = event.clipboardData?.files;
            if (files && Array.from(files).some((f) => f.type.startsWith('image/'))) {
              event.preventDefault();
              void handleImageFiles(view, files);
              return true;
            }
            return false;
          },
          drop(event, view) {
            const files = event.dataTransfer?.files;
            if (files && Array.from(files).some((f) => f.type.startsWith('image/'))) {
              event.preventDefault();
              const pos =
                view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
                view.state.selection.main.from;
              void handleImageFiles(view, files, pos);
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
              const fallbackLinkText = i18nRef.current.toolbar.defaultLinkText;
              const selected = view.state.sliceDoc(sel.from, sel.to) || fallbackLinkText;
              const urlTemplate = 'https://';
              const insert = `[${selected}](${urlTemplate})`;
              view.dispatch({
                changes: { from: sel.from, to: sel.to, insert },
                selection: EditorSelection.cursor(sel.from + 1 + selected.length + 2 + urlTemplate.length),
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
          {
            key: 'Escape',
            run: (view) => {
              if (searchPanelOpen(view.state)) return false;
              view.contentDOM.blur();
              return true;
            },
          },
        ]),
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
      destroyed = true;
      view.destroy();
      viewRef.current = null;
    };
  }, [docKey]);

  // Dynamically refresh Base64 chip labels via Compartment when UI locale changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: labelsCompartmentRef.current.reconfigure(createBase64LabelsExtension(t.base64)),
    });
  }, [t.base64]);

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
      annotations: [ExternalSyncAnnotation.of(true), Transaction.addToHistory.of(false)],
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
