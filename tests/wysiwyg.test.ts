import { Editor } from '@tiptap/core';
import { DOMParser as PMDOMParser, DOMSerializer as PMDOMSerializer } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractSelectionLatex } from '../src/editors/preview/BubbleFormatMenu';
import {
  createPreviewExtensions,
  PreviewEditor,
  type PreviewEditorHandle,
} from '../src/editors/preview/PreviewEditor';
import { setTableColumnAlignment } from '../src/editors/preview/TableFloatingBar';
import { getDictionary, getRegisteredLocales, I18nContext } from '../src/i18n';
import { markdownToProseMirrorDoc, proseMirrorDocToMarkdown } from '../src/markdown/bridge';
import { renderLatexHtml } from '../src/renderers/katexRenderer';

describe('WYSIWYG PreviewEditor & Custom Extensions', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      fn?.();
    }
    document.body.innerHTML = '';
  });

  function mountEditor(initialMarkdown: string, opts?: {
    locale?: 'es' | 'en';
    onChange?: (md: string) => void;
    onSaveShortcut?: () => void;
  }) {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const onChange = opts?.onChange ?? vi.fn();
    const onSaveShortcut = opts?.onSaveShortcut ?? vi.fn();
    const handleRef: { current: PreviewEditorHandle | null } = { current: null };

    const renderWithProps = (markdown: string, locale: 'es' | 'en' = opts?.locale ?? 'es') => {
      act(() => {
        render(
          h(
            I18nContext.Provider,
            {
              value: {
                locale,
                t: getDictionary(locale),
                availableLocales: getRegisteredLocales(),
                setLocale: () => undefined,
              },
            },
            h(PreviewEditor, {
              ref: handleRef,
              docKey: 'test-doc',
              markdown,
              theme: 'light',
              onChange,
              onSaveShortcut,
              onRequestImageFile: () => undefined,
            }),
          ),
          host,
        );
      });
    };

    renderWithProps(initialMarkdown, opts?.locale ?? 'es');

    cleanups.push(() => {
      act(() => {
        render(null, host);
      });
      host.remove();
    });

    return { host, onChange, onSaveShortcut, handleRef, rerender: renderWithProps };
  }

  it('buffers mathInline edits locally and deletes the node when committed empty instead of emitting bare $$', () => {
    const changes: string[] = [];
    const initialMd = '$E = mc^2$\n\n# Heading Below\n\nBody paragraph.\n';
    const { host } = mountEditor(initialMd, {
      onChange: (md) => changes.push(md),
    });

    const mathTrigger = host.querySelector('.pm-math-inline') as HTMLElement;
    expect(mathTrigger).toBeTruthy();

    act(() => {
      mathTrigger.click();
    });

    const input = host.querySelector('.pm-math-inline-input') as HTMLInputElement;
    expect(input).toBeTruthy();

    // Clearing input during typing must NOT dispatch onChange('') on keystrokes
    act(() => {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(changes).toHaveLength(0);

    // Committing empty draft via Enter must delete mathInline cleanly (zero bare $$)
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });

    expect(host.querySelector('.pm-math-inline')).toBeNull();
    expect(changes.length).toBeGreaterThan(0);
    const latestMd = changes[changes.length - 1];
    expect(latestMd).not.toContain('$$');
    expect(latestMd).toContain('# Heading Below');

    // Re-parsing serialized Markdown must preserve Heading Below as a real heading
    const reparsed = markdownToProseMirrorDoc(latestMd);
    expect(reparsed.content?.some((n) => n.type === 'heading')).toBe(true);
    expect(reparsed.content?.some((n) => n.type === 'mathBlock')).toBe(false);
  });

  it('deletes mathInline on blur when draft is whitespace-only, reverts on Escape, and closes cleanly on click', () => {
    const changes: string[] = [];
    const { host } = mountEditor('Value $a + b$ inline.\n', {
      onChange: (md) => changes.push(md),
    });

    let mathTrigger = host.querySelector('.pm-math-inline') as HTMLElement;
    expect(mathTrigger).toBeTruthy();

    // 1. Open, edit, and press Escape -> reverts without emitting changes and stops propagation
    act(() => {
      mathTrigger.click();
    });
    let input = host.querySelector('.pm-math-inline-input') as HTMLInputElement;
    expect(input).toBeTruthy();

    const windowEscSpy = vi.fn();
    window.addEventListener('keydown', windowEscSpy);
    cleanups.push(() => window.removeEventListener('keydown', windowEscSpy));

    act(() => {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });

    expect(windowEscSpy).not.toHaveBeenCalled();
    expect(host.querySelector('.pm-math-inline-input')).toBeNull();
    expect(host.querySelector('.pm-math-inline')).toBeTruthy();
    expect(changes).toHaveLength(0);

    // 2. Open and click .pm-math-inline again -> closes without blur->click reopen race
    mathTrigger = host.querySelector('.pm-math-inline') as HTMLElement;
    act(() => {
      mathTrigger.click();
    });
    expect(host.querySelector('.pm-math-inline-input')).toBeTruthy();

    act(() => {
      const mdEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      mathTrigger.dispatchEvent(mdEvent);
      expect(mdEvent.defaultPrevented).toBe(true);
      mathTrigger.click();
    });
    expect(host.querySelector('.pm-math-inline-input')).toBeNull();

    // 3. Open, set whitespace-only, and blur -> deletes mathInline node cleanly
    act(() => {
      mathTrigger.click();
    });
    input = host.querySelector('.pm-math-inline-input') as HTMLInputElement;
    act(() => {
      input.focus();
      input.value = '   ';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.blur();
    });

    expect(host.querySelector('.pm-math-inline')).toBeNull();
    expect(changes.length).toBe(1);
    expect(changes[0]).not.toContain('$');
    expect(changes[0]).toContain('Value');
    expect(changes[0]).toContain('inline.');
  });

  it('does NOT fire onSaveShortcut on Ctrl+Shift+S, and stops propagation on Ctrl+S', () => {
    const onSaveShortcut = vi.fn();
    const { host } = mountEditor('# Shortcut Test\n', { onSaveShortcut });

    const pmEl = host.querySelector('[data-testid="preview-editor"]') as HTMLElement;
    expect(pmEl).toBeTruthy();

    const windowKeySpy = vi.fn();
    window.addEventListener('keydown', windowKeySpy);
    cleanups.push(() => window.removeEventListener('keydown', windowKeySpy));

    // Ctrl+Shift+S ("Save As") must NOT trigger PreviewEditor's onSaveShortcut
    const saveAsEvent = new KeyboardEvent('keydown', {
      key: 'S',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    pmEl.dispatchEvent(saveAsEvent);
    expect(onSaveShortcut).not.toHaveBeenCalled();
    expect(saveAsEvent.defaultPrevented).toBe(false);
    expect(windowKeySpy).toHaveBeenCalledTimes(1);

    windowKeySpy.mockClear();

    // Plain Ctrl+S must trigger onSaveShortcut once and NOT bubble to window
    const saveEvent = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      shiftKey: false,
      bubbles: true,
      cancelable: true,
    });
    pmEl.dispatchEvent(saveEvent);
    expect(onSaveShortcut).toHaveBeenCalledTimes(1);
    expect(saveEvent.defaultPrevented).toBe(true);
    expect(windowKeySpy).not.toHaveBeenCalled();
  });

  it('serializes custom atom nodes via renderText, preserves inline math in selection conversion, and blocks HTML attribute smuggling', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const md = `---
title: Doc Meta
---

Formula $E = mc^2$ and $a + b$ with <kbd>Ctrl</kbd>.

$$
x^2 + y^2 = z^2
$$

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`

<div>raw-block</div>
`;
    const editor = new Editor({
      element: el,
      content: markdownToProseMirrorDoc(md),
      extensions: createPreviewExtensions(),
    });
    cleanups.push(() => {
      editor.destroy();
      el.remove();
    });

    const plainText = editor.getText();
    expect(plainText).toContain('---\ntitle: Doc Meta\n---');
    expect(plainText).toContain('$E = mc^2$');
    expect(plainText).toContain('$$\nx^2 + y^2 = z^2\n$$');
    expect(plainText).toContain('```mermaid\nflowchart LR\n  A --> B\n```');
    expect(plainText).toContain('<div>raw-block</div>');
    expect(plainText).toContain('<kbd>Ctrl</kbd>');

    // Select paragraph containing "$E = mc^2$ and $a + b$ with <kbd>Ctrl</kbd>."
    let paraStart = 0;
    let paraEnd = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph') {
        paraStart = pos + 1;
        paraEnd = pos + node.nodeSize - 1;
        return false;
      }
      return true;
    });
    editor.commands.setTextSelection({ from: paraStart, to: paraEnd });
    const extracted = extractSelectionLatex(editor);
    expect(extracted).toContain('E = mc^2');
    expect(extracted).toContain('a + b');
    expect(extracted).toContain('<kbd>Ctrl</kbd>');

    // External HTML paste smuggling check: neither bare value= nor forged data-internal-raw is accepted
    const maliciousContainer = document.createElement('div');
    maliciousContainer.innerHTML =
      '<div data-type="raw-html-block" value="<script>alert(1)</script>">safe</div>' +
      '<div data-type="raw-html-block" data-internal-raw="forged" data-raw-value="<img src=x onerror=alert(1)>">safe2</div>' +
      '<p><code data-type="raw-html-inline" value="<script>alert(2)</script>">inline</code></p>';
    const parsedExternal = PMDOMParser.fromSchema(editor.schema).parse(maliciousContainer);
    let smuggledCount = 0;
    parsedExternal.descendants((node) => {
      if (node.type.name === 'rawHtmlBlock' || node.type.name === 'rawHtmlInline') {
        smuggledCount++;
      }
    });
    expect(smuggledCount).toBe(0);

    // Internal DOMSerializer -> DOMParser within same session still preserves rawHtml nodes
    const internalFragment = PMDOMSerializer.fromSchema(editor.schema).serializeFragment(
      editor.state.doc.content,
    );
    const internalHolder = document.createElement('div');
    internalHolder.appendChild(internalFragment);
    const parsedInternal = PMDOMParser.fromSchema(editor.schema).parse(internalHolder);
    let internalRawCount = 0;
    parsedInternal.descendants((node) => {
      if (node.type.name === 'rawHtmlBlock' || node.type.name === 'rawHtmlInline') {
        internalRawCount++;
      }
    });
    expect(internalRawCount).toBe(3);
  });

  it('disables Underline mark in schema and commands', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const editor = new Editor({
      element: el,
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pure markdown' }] }] },
      extensions: createPreviewExtensions(),
    });
    cleanups.push(() => {
      editor.destroy();
      el.remove();
    });

    expect(editor.schema.marks.underline).toBeUndefined();
    expect('toggleUnderline' in editor.commands).toBe(false);

    // Pasting <u> HTML strips underline mark cleanly
    const htmlWrap = document.createElement('div');
    htmlWrap.innerHTML = '<p><u>Underlined</u> normal</p>';
    const parsed = PMDOMParser.fromSchema(editor.schema).parse(htmlWrap);
    const md = proseMirrorDocToMarkdown(parsed.toJSON());
    expect(md.trim()).toBe('Underlined normal');
  });

  it('locks Frontmatter strictly to index 0 of Document and handles frontmatter-only docs', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const editor = new Editor({
      element: el,
      content: {
        type: 'doc',
        content: [
          { type: 'frontmatter', attrs: { value: 'title: Locked' } },
          { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
        ],
      },
      extensions: createPreviewExtensions(),
    });
    cleanups.push(() => {
      editor.destroy();
      el.remove();
    });

    expect(editor.schema.topNodeType.spec.content).toBe('frontmatter? block+');
    expect(editor.schema.nodes.frontmatter.spec.group).toBeUndefined();

    // Cannot insert a paragraph before frontmatter at index 0
    expect(editor.state.doc.canReplaceWith(0, 0, editor.schema.nodes.paragraph)).toBe(false);

    // Schema rejects frontmatter placed after another block or duplicated
    expect(() =>
      editor.schema
        .nodeFromJSON({
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Above' }] },
            { type: 'frontmatter', attrs: { value: 'title: Invalid' } },
          ],
        })
        .check(),
    ).toThrow();

    expect(() =>
      editor.schema
        .nodeFromJSON({
          type: 'doc',
          content: [
            { type: 'frontmatter', attrs: { value: 'title: One' } },
            { type: 'frontmatter', attrs: { value: 'title: Two' } },
            { type: 'paragraph' },
          ],
        })
        .check(),
    ).toThrow();

    // Frontmatter-only Markdown mounts cleanly without crashing or firing spurious onChange
    const onChange = vi.fn();
    const { host } = mountEditor('---\ntitle: Frontmatter Only\n---\n', { onChange });
    expect(host.querySelector('.pm-frontmatter-card')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('preserves selection via minimal diff external sync, renders untagged CodeBlock header, and aligns entire table columns', () => {
    const onChange = vi.fn();
    const { host, rerender } = mountEditor('First paragraph.\n\n```\nconst a = 1;\n```\n', {
      locale: 'es',
      onChange,
    });

    // Untagged code block must NOT stamp 'plaintext' and must render native header controls
    const langSelect = host.querySelector('.pm-code-lang-select') as HTMLSelectElement;
    const copyBtn = host.querySelector('.pm-code-copy-btn') as HTMLButtonElement;
    expect(langSelect).toBeTruthy();
    expect(copyBtn).toBeTruthy();
    expect(langSelect.value).toBe('');
    expect(copyBtn.textContent).toBe(getDictionary('es').blocks.copyCode);

    // Switching locale updates live NodeView header labels without recreating DOM
    rerender('First paragraph.\n\n```\nconst a = 1;\n```\n', 'en');
    expect(copyBtn.isConnected).toBe(true);
    expect(copyBtn.textContent).toBe(getDictionary('en').blocks.copyCode);

    // Standalone editor test for minimal external sync & column-wide table alignment
    const el = document.createElement('div');
    document.body.appendChild(el);
    const tableMd = `| Col A | Col B |
| :--- | :--- |
| r1c1 | r1c2 |
| r2c1 | r2c2 |
`;
    const editor = new Editor({
      element: el,
      content: markdownToProseMirrorDoc(tableMd),
      extensions: createPreviewExtensions(),
    });
    cleanups.push(() => {
      editor.destroy();
      el.remove();
    });

    // Place cursor inside row 2 (last body row), column 2 ("r2c2")
    let targetPos = 1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'r2c2') {
        targetPos = pos + 1;
        return false;
      }
      return true;
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, targetPos)),
    );

    expect(setTableColumnAlignment(editor, 'right')).toBe(true);

    const serializedTable = proseMirrorDocToMarkdown(editor.getJSON());
    expect(serializedTable).toMatch(/\| :-+\s*\|\s*-+: \|/);

    // Clicking 'right' again toggles column 2 alignment back to null (unaligned)
    expect(setTableColumnAlignment(editor, 'right')).toBe(true);
    const resetTable = proseMirrorDocToMarkdown(editor.getJSON());
    expect(resetTable).not.toContain('---:');
  });

  it('caps oversized KaTeX rules safely via maxSize and preserves external-sync non-loop invariant', async () => {
    const res = await renderLatexHtml('\\rule{999999em}{999999em}', false);
    expect(res.html).toContain('katex');
    expect(res.html).toContain('width:50em');
    expect(res.html).not.toContain('width:999999em');

    const onChange = vi.fn();
    const { host, rerender } = mountEditor('Paragraph one.\n\nParagraph two.\n', { onChange });
    rerender('Paragraph one.\n\nParagraph two updated externally.\n');
    expect(host.textContent).toContain('Paragraph two updated externally.');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps GithubAlert NodeView intact across locale switches via ignoreMutation and updates Placeholder dynamically', () => {
    const { host, rerender } = mountEditor('> [!NOTE]\n> Alert content inside.\n', { locale: 'es' });
    const alertEl = host.querySelector('.pm-github-alert') as HTMLElement;
    const alertSelect = host.querySelector('.pm-github-alert-select') as HTMLSelectElement;
    expect(alertEl).toBeTruthy();
    expect(alertSelect.options[0].textContent).toBe(getDictionary('es').blocks.alerts.NOTE);

    rerender('> [!NOTE]\n> Alert content inside.\n', 'en');
    // Same DOM element instance preserved (not torn down / recreated)
    expect(host.querySelector('.pm-github-alert')).toBe(alertEl);
    expect(alertSelect.options[0].textContent).toBe(getDictionary('en').blocks.alerts.NOTE);

    // Empty editor updates Placeholder data-placeholder dynamically on locale switch
    const emptyMounted = mountEditor('', { locale: 'es' });
    const emptyParaEs = emptyMounted.host.querySelector('p[data-placeholder]');
    expect(emptyParaEs?.getAttribute('data-placeholder')).toBe(
      getDictionary('es').blocks.placeholderEditor,
    );
    emptyMounted.rerender('', 'en');
    const emptyParaEn = emptyMounted.host.querySelector('p[data-placeholder]');
    expect(emptyParaEn?.getAttribute('data-placeholder')).toBe(
      getDictionary('en').blocks.placeholderEditor,
    );
  });

  it('supports ordered task lists and linked inline math/images from AST bridge without schema errors', () => {
    const md = `1. [x] First ordered task\n2. [ ] Second ordered task\n\n[![badge](https://example.com/a.png)](https://example.com) and [$x^2$](https://example.com/math)\n`;
    const el = document.createElement('div');
    document.body.appendChild(el);
    const editor = new Editor({
      element: el,
      content: markdownToProseMirrorDoc(md),
      extensions: createPreviewExtensions(),
    });
    cleanups.push(() => {
      editor.destroy();
      el.remove();
    });

    expect(() => editor.state.doc.check()).not.toThrow();
    const roundTripped = proseMirrorDocToMarkdown(editor.getJSON());
    expect(roundTripped).toContain('1. [x] First ordered task');
    expect(roundTripped).toContain('2. [ ] Second ordered task');
    expect(roundTripped).toContain('[![badge](https://example.com/a.png)](https://example.com)');
  });
});
