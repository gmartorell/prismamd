// @vitest-environment jsdom
import { history, undoDepth } from '@codemirror/commands';
import { SearchQuery, replaceAll, search, setSearchQuery } from '@codemirror/search';
import { Compartment, EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { describe, expect, it, vi } from 'vitest';
import {
  computeMinimalDiff,
  ExternalSyncAnnotation,
  RawEditor,
  type RawEditorHandle,
  toggleMarkdownWrap,
} from '../src/editors/raw/RawEditor';
import {
  base64FoldStateField,
  createBase64FoldExtension,
  createBase64LabelsExtension,
  findBase64DataUriRanges,
} from '../src/editors/raw/base64FoldExtension';
import { getDictionary, getRegisteredLocales, I18nContext } from '../src/i18n';
import { estimateBase64Bytes, formatByteSize } from '../src/markdown/imageDataUri';

describe('Raw Base64 Data URI folding & RawEditor helpers', () => {
  it('detects long data:image base64 payloads without crossing lines', () => {
    const longPayload = 'A'.repeat(240);
    const line = `![captura](data:image/png;base64,${longPayload}) y texto normal`;
    const matches = findBase64DataUriRanges(line, 100);

    expect(matches).toHaveLength(1);
    expect(matches[0].mime).toBe('png');
    expect(matches[0].from).toBe(100 + line.indexOf('data:image/'));
    expect(matches[0].to).toBe(100 + line.indexOf(')'));
    expect(matches[0].approxBytes).toBe(180);
  });

  it('ignores short base64 snippets and normal HTTPS URLs', () => {
    const line = '![logo](https://example.com/logo.png) and ![tiny](data:image/png;base64,AAAA)';
    const matches = findBase64DataUriRanges(line, 0);
    expect(matches).toHaveLength(0);
  });

  it('formats byte sizes and estimates padded base64 bytes cleanly', () => {
    expect(formatByteSize(512)).toBe('512 B');
    expect(formatByteSize(2048)).toBe('2 KB');
    expect(formatByteSize(1572864)).toBe('1.5 MB');
    expect(estimateBase64Bytes('QUJDRA==')).toBe(4);
    expect(estimateBase64Bytes('QUJDREU=')).toBe(5);
  });

  it('tracks Base64 ranges incrementally in StateField, never crosses newlines, and toggles via click/keyboard', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const payload1 = 'B'.repeat(200);
    const payload2 = 'C'.repeat(200);
    const initialDoc = `Intro line\n![one](data:image/png;base64,${payload1})\nMiddle\n![two](data:image/jpeg;base64,${payload2})`;

    const labelsCompartment = new Compartment();
    const esLabels = { expand: 'Expandir', collapse: 'Plegar', imageLabel: 'Imagen Base64' };
    const enLabels = { expand: 'Expand', collapse: 'Collapse', imageLabel: 'Base64 image' };

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          createBase64FoldExtension(esLabels),
          labelsCompartment.of(createBase64LabelsExtension(esLabels)),
        ],
      }),
    });

    const foldState0 = view.state.field(base64FoldStateField);
    expect(foldState0.matches).toHaveLength(2);
    // Verify strict single-line invariant (AGENTS.md §3.3)
    for (const m of foldState0.matches) {
      const startLine = view.state.doc.lineAt(m.from);
      const endLine = view.state.doc.lineAt(m.to);
      expect(startLine.number).toBe(endLine.number);
    }

    // Typing on line 1 shifts downstream Base64 match offsets incrementally
    const oldFirstFrom = foldState0.matches[0].from;
    view.dispatch({ changes: { from: 0, to: 0, insert: 'Prefix ' } });
    const foldState1 = view.state.field(base64FoldStateField);
    expect(foldState1.matches).toHaveLength(2);
    expect(foldState1.matches[0].from).toBe(oldFirstFrom + 'Prefix '.length);

    // Chip button renders Spanish label initially and toggles via click (including keyboard Enter/Space click)
    const chip = host.querySelector<HTMLButtonElement>('.cm-base64-chip');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain('[Expandir]');

    // mousedown prevents default cursor jump without toggling prematurely
    const mdEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    chip?.dispatchEvent(mdEvent);
    expect(mdEvent.defaultPrevented).toBe(true);
    expect(view.state.field(base64FoldStateField).expanded.size).toBe(0);

    // click expands the chip and renders the collapse button
    chip?.click();
    expect(view.state.field(base64FoldStateField).expanded.size).toBe(1);
    const collapseBtn = host.querySelector<HTMLButtonElement>('.cm-base64-chip-collapse');
    expect(collapseBtn?.textContent).toBe('[Plegar]');

    // Reconfiguring Compartment refreshes chip labels in place while keeping expanded state intact
    view.dispatch({
      effects: labelsCompartment.reconfigure(createBase64LabelsExtension(enLabels)),
    });
    expect(view.state.field(base64FoldStateField).expanded.size).toBe(1);
    expect(host.querySelector('.cm-base64-chip-collapse')?.textContent).toBe('[Collapse]');
    expect(host.querySelector('.cm-base64-chip:not(.cm-base64-chip-collapse)')?.textContent).toContain(
      '[Expand]',
    );

    // Clicking collapse folds the first image back
    host.querySelector<HTMLButtonElement>('.cm-base64-chip-collapse')?.click();
    expect(view.state.field(base64FoldStateField).expanded.size).toBe(0);

    view.destroy();
    host.remove();
  });

  it('prevents Replace All and multi-change bulk edits from corrupting folded Base64 payloads', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const payloadWithWord = `${'A'.repeat(80)}cat${'B'.repeat(80)}`;
    const doc = `The cat is here.\n![pet](data:image/png;base64,${payloadWithWord})\nAnother cat below.`;

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc,
        extensions: [
          search({ top: true }),
          createBase64FoldExtension({ expand: 'Expand', collapse: 'Collapse', imageLabel: 'Base64' }),
        ],
      }),
    });

    const query = new SearchQuery({ search: 'cat', replace: 'dog' });
    view.dispatch({ effects: setSearchQuery.of(query) });
    replaceAll(view);

    const updated = view.state.doc.toString();
    expect(updated).toContain('The dog is here.');
    expect(updated).toContain('Another dog below.');
    // Folded Base64 payload MUST remain 100% intact
    expect(updated).toContain(`data:image/png;base64,${payloadWithWord}`);

    // Once explicitly expanded by the user, Replace All is allowed to modify it
    host.querySelector<HTMLButtonElement>('.cm-base64-chip')?.click();
    const query2 = new SearchQuery({ search: 'cat', replace: 'FOX' });
    view.dispatch({ effects: setSearchQuery.of(query2) });
    replaceAll(view);
    expect(view.state.doc.toString()).toContain(`data:image/png;base64,${'A'.repeat(80)}FOX${'B'.repeat(80)}`);

    view.destroy();
    host.remove();
  });

  it('toggles **bold** and *italic* cleanly without ****quadruple**** stars or stripping **bold** on Ctrl+I', () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: 'hello world',
        selection: EditorSelection.range(0, 5),
      }),
    });

    // 1st Ctrl+B wraps -> **hello** world (selection stays on "hello")
    toggleMarkdownWrap(view, '**');
    expect(view.state.doc.toString()).toBe('**hello** world');
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('hello');

    // 2nd Ctrl+B unwraps -> hello world (not ****hello****!)
    toggleMarkdownWrap(view, '**');
    expect(view.state.doc.toString()).toBe('hello world');

    // Ctrl+B then Ctrl+I wraps to ***hello*** world
    toggleMarkdownWrap(view, '**');
    toggleMarkdownWrap(view, '*');
    expect(view.state.doc.toString()).toBe('***hello*** world');

    // Pressing Ctrl+I again removes italic leaving **hello** world
    toggleMarkdownWrap(view, '*');
    expect(view.state.doc.toString()).toBe('**hello** world');

    // Selecting "**hello**" directly (including stars) and pressing Ctrl+I wraps to "***hello***"
    view.dispatch({ selection: EditorSelection.range(0, 9) });
    toggleMarkdownWrap(view, '*');
    expect(view.state.doc.toString()).toBe('***hello*** world');

    view.destroy();
  });

  it('keeps computeMinimalDiff surrogate-pair safe and isolates external sync from undo history', () => {
    // 😀 (\uD83D\uDE00) vs 😁 (\uD83D\uDE01) share high surrogate 0xD83D
    const oldEmoji = 'Hi 😀 end';
    const newEmoji = 'Hi 😁 end';
    const diff = computeMinimalDiff(oldEmoji, newEmoji);
    expect(diff.insert).toBe('😁');
    expect(oldEmoji.slice(0, diff.from) + diff.insert + oldEmoji.slice(diff.to)).toBe(newEmoji);

    // External sync dispatch with Transaction.addToHistory.of(false) does not pollute undoDepth
    const state = EditorState.create({
      doc: 'Initial demo',
      extensions: [history()],
    });
    const view = new EditorView({ state });
    const syncDiff = computeMinimalDiff(view.state.doc.toString(), 'Restored session notes');
    view.dispatch({
      changes: syncDiff,
      annotations: [ExternalSyncAnnotation.of(true), Transaction.addToHistory.of(false)],
    });
    expect(view.state.doc.toString()).toBe('Restored session notes');
    expect(undoDepth(view.state)).toBe(0);
    view.destroy();
  });

  it('mounts RawEditor with history-isolated external sync, Ctrl+S vs Ctrl+Shift+S guard, Escape blur, and live i18n chips', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const onChange = vi.fn();
    const onSaveShortcut = vi.fn();
    const windowKeydown = vi.fn();
    window.addEventListener('keydown', windowKeydown);

    const longPayload = 'D'.repeat(180);
    let handle: RawEditorHandle | null = null;

    const mountWith = (locale: 'es' | 'en', md: string) => {
      const dict = getDictionary(locale);
      act(() => {
        render(
          h(
            I18nContext.Provider,
            {
              value: {
                locale,
                t: dict,
                availableLocales: getRegisteredLocales(),
                setLocale: () => undefined,
              },
            },
            h(RawEditor, {
              ref: (r: RawEditorHandle | null) => {
                handle = r;
              },
              docKey: 'tab-1',
              markdown: md,
              theme: 'dark',
              onChange,
              onSaveShortcut,
            }),
          ),
          container,
        );
      });
    };

    // Polyfill jsdom Range layout stubs used by CodeMirror drawSelection() on focus
    Range.prototype.getClientRects ??= () => ([] as unknown) as DOMRectList;
    Range.prototype.getBoundingClientRect ??= () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    });

    const esExpand = getDictionary('es').base64.expand;
    const enExpand = getDictionary('en').base64.expand;

    mountWith('es', `Demo\n![img](data:image/png;base64,${longPayload})`);
    expect(container.querySelector('.cm-base64-chip')?.textContent).toContain(`[${esExpand}]`);

    // External sync update + locale switch -> updates chip label and never calls onChange
    mountWith('en', `Restored note\n![img](data:image/png;base64,${longPayload})`);
    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector('.cm-base64-chip')?.textContent).toContain(`[${enExpand}]`);

    const contentDom = container.querySelector<HTMLElement>('.cm-content');
    expect(contentDom).not.toBeNull();

    // Ctrl+Z in RawEditor must NOT revert the externally restored session back to "Demo..."
    contentDom?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(onChange).not.toHaveBeenCalled();
    windowKeydown.mockClear();

    // Ctrl+S triggers onSaveShortcut once and stops propagation to window
    const saveEvt = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    contentDom?.dispatchEvent(saveEvt);
    expect(saveEvt.defaultPrevented).toBe(true);
    expect(onSaveShortcut).toHaveBeenCalledTimes(1);
    expect(windowKeydown).not.toHaveBeenCalled();

    // Ctrl+Shift+S ("Save As") does NOT trigger onSaveShortcut and bubbles to window
    contentDom?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'S',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(onSaveShortcut).toHaveBeenCalledTimes(1);
    expect(windowKeydown).toHaveBeenCalledTimes(1);

    // Escape blurs editor when search panel is closed (no keyboard trap with indentWithTab)
    handle!.focus();
    expect(document.activeElement).toBe(contentDom);
    contentDom?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).not.toBe(contentDom);

    window.removeEventListener('keydown', windowKeydown);
    act(() => {
      render(null, container);
    });
    container.remove();
  });
});
