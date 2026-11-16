import { describe, expect, it } from 'vitest';
import {
  computeDocumentStats,
  extractHeadingsOutline,
  markdownToProseMirrorDoc,
  proseMirrorDocToMarkdown,
} from '../src/markdown/bridge';
import { sanitizeImageAlt } from '../src/markdown/imageDataUri';

describe('Markdown <-> ProseMirror bidirectional bridge', () => {
  it('round-trips frontmatter, headings, formatting, links, lists, tasks, and aligned tables', () => {
    const input = `---
title: Test Doc
tags: [md, fast]
---

# Heading One

Paragraph with **bold**, *italic*, ~~strike~~, \`inlineCode\`, and [Prisma](https://example.com).

- Bullet A
- Bullet B
  1. Nested 1
  2. Nested 2

- [x] Done task
- [ ] Pending task

| Name | Align | Score |
| :--- | :---: | ---: |
| Alpha | Center | 100 |
| Beta | Mid | 200 |
`;

    const pmDoc = markdownToProseMirrorDoc(input);
    const serialized = proseMirrorDocToMarkdown(pmDoc);
    const pmDoc2 = markdownToProseMirrorDoc(serialized);

    expect(pmDoc.content?.some((n) => n.type === 'frontmatter')).toBe(true);
    expect(pmDoc.content?.some((n) => n.type === 'taskList')).toBe(true);
    expect(pmDoc.content?.some((n) => n.type === 'table')).toBe(true);
    expect(pmDoc2).toEqual(pmDoc);

    expect(serialized).toContain('title: Test Doc');
    expect(serialized).toContain('- Bullet A');
    expect(serialized).toMatch(/[-*] \[x\] Done task/);
    expect(serialized).toMatch(/[-*] \[ \] Pending task/);
    expect(serialized).toMatch(/\| :-+\s*\|\s*:-+:\s*\|\s*-+: \|/);
  });

  it('preserves empty YAML frontmatter without deleting it via .trim()', () => {
    const emptyFmWithBody = `---\n---\n\n# Title\n`;
    const pmDoc = markdownToProseMirrorDoc(emptyFmWithBody);
    expect(pmDoc.content?.[0]).toEqual({
      type: 'frontmatter',
      attrs: { value: '' },
    });

    const serialized = proseMirrorDocToMarkdown(pmDoc);
    expect(serialized).toBe('---\n---\n\n# Title\n');
    expect(markdownToProseMirrorDoc(serialized)).toEqual(pmDoc);

    // Frontmatter-only document always includes a trailing block for `frontmatter? block+` schema
    const fmOnly = `---\n---\n`;
    const pmFmOnly = markdownToProseMirrorDoc(fmOnly);
    expect(pmFmOnly.content).toEqual([
      { type: 'frontmatter', attrs: { value: '' } },
      { type: 'paragraph' },
    ]);
    expect(proseMirrorDocToMarkdown(pmFmOnly)).toBe('---\n---\n');
  });

  it('round-trips all 5 GitHub Alerts cleanly without escaping brackets', () => {
    const kinds = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'] as const;
    for (const kind of kinds) {
      const md = `> [!${kind}]\n> Message with **emphasis** inside.\n`;
      const pmDoc = markdownToProseMirrorDoc(md);
      const alertNode = pmDoc.content?.[0];
      expect(alertNode?.type).toBe('githubAlert');
      expect(alertNode?.attrs?.alertType).toBe(kind);

      const roundTripped = proseMirrorDocToMarkdown(pmDoc);
      expect(roundTripped).toContain(`> [!${kind}]`);
      expect(roundTripped).not.toContain(`\\[`);
    }
  });

  it('round-trips Mermaid blocks, inline/block KaTeX math, code blocks, raw HTML, and Base64 images', () => {
    const fakePng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const md = `\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`

Inline $E = mc^2$ formula.

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$

\`\`\`ts
const x: number = 42;
\`\`\`

<div>raw block</div>

![pixel](data:image/png;base64,${fakePng})
`;

    const pmDoc = markdownToProseMirrorDoc(md);
    const types = (pmDoc.content ?? []).map((n) => n.type);
    expect(types).toContain('mermaidBlock');
    expect(types).toContain('mathBlock');
    expect(types).toContain('codeBlock');
    expect(types).toContain('rawHtmlBlock');

    const back = proseMirrorDocToMarkdown(pmDoc);
    expect(back).toContain('```mermaid');
    expect(back).toContain('$E = mc^2$');
    expect(back).toContain('$$');
    expect(back).toContain('```ts');
    expect(back).toContain('<div>raw block</div>');
    expect(back).toContain(`data:image/png;base64,${fakePng}`);
  });

  it('preserves reference-style links, Base64 reference images, linked badges, and standalone definitions', () => {
    const md = `See [Prisma][p], [Implicit][], and ![logo][img] plus [![CI][badge]][p].

[p]: https://example.com "Prisma Docs"
[implicit]: https://implicit.example.com
[img]: data:image/png;base64,AAAA
[badge]: https://img.shields.io/badge.svg
[//]: # "hidden comment"
`;

    const pmDoc = markdownToProseMirrorDoc(md);
    const serialized = proseMirrorDocToMarkdown(pmDoc);

    expect(serialized).toContain('[Prisma](https://example.com "Prisma Docs")');
    expect(serialized).toContain('[Implicit](https://implicit.example.com)');
    expect(serialized).toContain('![logo](data:image/png;base64,AAAA)');
    expect(serialized).toContain('[![CI](https://img.shields.io/badge.svg)](https://example.com "Prisma Docs")');
    expect(serialized).toContain('[//]: # "hidden comment"');
    expect(markdownToProseMirrorDoc(serialized)).toEqual(pmDoc);
  });

  it('round-trips GFM inline footnotes and single/multi-paragraph footnote definitions without data loss', () => {
    const md = `Claim[^1] and **bold citation[^note]** here.

[^1]: Source **note** with [link](https://example.com).

[^note]: First paragraph of note.

    Second paragraph with \`code\`.
`;

    const pmDoc = markdownToProseMirrorDoc(md);
    const serialized = proseMirrorDocToMarkdown(pmDoc);
    const pmDoc2 = markdownToProseMirrorDoc(serialized);

    expect(serialized).toContain('Claim[^1]');
    expect(serialized).toContain('**bold citation[^note]**');
    expect(serialized).toContain('[^1]: Source **note** with [link](https://example.com).');
    expect(serialized).toContain('[^note]: First paragraph of note.');
    expect(serialized).toContain('Second paragraph with `code`.');
    expect(pmDoc2).toEqual(pmDoc);
  });

  it('groups shared inline marks across adjacent nodes (links, bold/italic, linked images & math) without &#x20;', () => {
    const md = `Check [link with **bold** word](https://example.com), [**bold** link](https://example.com), [![badge](https://img.shields.io/b.svg)](https://ci.example.com), [$x^2$](https://math.example.com), and **bold and *italic* text**.\n`;

    const pmDoc = markdownToProseMirrorDoc(md);
    const serialized = proseMirrorDocToMarkdown(pmDoc);

    expect(serialized).toBe(md);
    expect(serialized).not.toContain('&#x20;');

    // Boundary spaces inside bold/italic selections from WYSIWYG are hoisted cleanly without &#x20;
    const trailingSpaceDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'bold ', marks: [{ type: 'bold' }] },
            { type: 'text', text: 'after', marks: [{ type: 'underline' }] },
          ],
        },
      ],
    };
    expect(proseMirrorDocToMarkdown(trailingSpaceDoc)).toBe('**bold** after\n');
  });

  it('preserves code fence meta strings and defaults untagged fences to empty language', () => {
    const md = `\`\`\`ts title="src/app.ts" {1-3}
const a = 1;
\`\`\`

\`\`\`
plain untagged block
\`\`\`
`;

    const pmDoc = markdownToProseMirrorDoc(md);
    expect(pmDoc.content?.[0]).toEqual({
      type: 'codeBlock',
      attrs: { language: 'ts', meta: 'title="src/app.ts" {1-3}' },
      content: [{ type: 'text', text: 'const a = 1;' }],
    });
    expect(pmDoc.content?.[1]).toEqual({
      type: 'codeBlock',
      attrs: { language: '', meta: null },
      content: [{ type: 'text', text: 'plain untagged block' }],
    });

    const serialized = proseMirrorDocToMarkdown(pmDoc);
    expect(serialized).toContain('```ts title="src/app.ts" {1-3}');
    expect(serialized).not.toContain('plaintext');
    expect(markdownToProseMirrorDoc(serialized)).toEqual(pmDoc);
  });

  it('splits mixed unordered bullet/task lists and preserves checkboxes on ordered task lists', () => {
    const md = `- Normal bullet
- [x] Checked task
- [ ] Unchecked task
- Trailing bullet

1. [x] First step
2. [ ] Second step
3. Third normal step
`;

    const pmDoc = markdownToProseMirrorDoc(md);
    expect(pmDoc.content?.map((n) => n.type)).toEqual([
      'bulletList',
      'taskList',
      'bulletList',
      'orderedList',
    ]);

    const orderedItems = pmDoc.content?.[3]?.content ?? [];
    expect(orderedItems[0]).toMatchObject({ type: 'taskItem', attrs: { checked: true } });
    expect(orderedItems[1]).toMatchObject({ type: 'taskItem', attrs: { checked: false } });
    expect(orderedItems[2]).toMatchObject({ type: 'listItem' });

    const serialized = proseMirrorDocToMarkdown(pmDoc);
    expect(serialized).toContain('1. [x] First step');
    expect(serialized).toContain('2. [ ] Second step');
    expect(serialized).toContain('3. Third normal step');
    expect(markdownToProseMirrorDoc(serialized)).toEqual(pmDoc);
  });

  it('handles multi-paragraph table cells, rich blocks in cells, math pipes, and body-row alignment edits', () => {
    const pmTableDoc = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  attrs: { colspan: 1, rowspan: 1, colwidth: null, textAlign: 'left' },
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Notes' }] }],
                },
                {
                  type: 'tableHeader',
                  attrs: { colspan: 1, rowspan: 1, colwidth: null, textAlign: 'left' },
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Math' }] }],
                },
                {
                  type: 'tableHeader',
                  attrs: { colspan: 1, rowspan: 1, colwidth: null, textAlign: null },
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'List' }] }],
                },
              ],
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  attrs: { colspan: 1, rowspan: 1, colwidth: null, textAlign: 'left' },
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'Line 1' }] },
                    { type: 'paragraph', content: [{ type: 'text', text: 'Line 2' }] },
                  ],
                },
                {
                  type: 'tableCell',
                  // Body cell alignment changed from 'left' to 'right'
                  attrs: { colspan: 1, rowspan: 1, colwidth: null, textAlign: 'right' },
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'mathInline', attrs: { latex: '|x| = \\|v\\|' } }],
                    },
                  ],
                },
                {
                  type: 'tableCell',
                  attrs: { colspan: 1, rowspan: 1, colwidth: null, textAlign: 'center' },
                  content: [
                    {
                      type: 'bulletList',
                      content: [
                        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item A' }] }] },
                        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item B' }] }] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const serialized = proseMirrorDocToMarkdown(pmTableDoc);
    expect(serialized).toContain('Line 1<br>Line 2');
    expect(serialized).toContain('Item A');
    expect(serialized).toContain('Item B');
    expect(serialized).toContain('\\vert x\\vert = \\|v\\|');

    // Re-parse must keep all 3 columns intact (no split on math `|`) and preserve multi-paragraph & alignments
    const reparsed = markdownToProseMirrorDoc(serialized);
    const table = reparsed.content?.[0];
    expect(table?.type).toBe('table');
    expect(table?.content?.[1]?.content).toHaveLength(3);
    expect(table?.content?.[1]?.content?.[0]?.content).toHaveLength(2);
    expect(table?.content?.[0]?.content?.[1]?.attrs?.textAlign).toBe('right');
    expect(table?.content?.[0]?.content?.[2]?.attrs?.textAlign).toBe('center');
  });

  it('guards prose currency ($10 and $20) while preserving valid inline math and single-line $$...$$ mathBlock', () => {
    const md = `Cost is $10 and $20 today, or $10-$20, vs valid $x$, $2+2=4$, and $e^{i\\pi}+1=0$.

$$E = mc^2$$
`;

    const pmDoc = markdownToProseMirrorDoc(md);
    const para = pmDoc.content?.[0];
    const inlineMathNodes = (para?.content ?? []).filter((n) => n.type === 'mathInline');
    expect(inlineMathNodes.map((n) => n.attrs?.latex)).toEqual(['x', '2+2=4', 'e^{i\\pi}+1=0']);

    const fullText = (para?.content ?? [])
      .filter((n) => n.type === 'text')
      .map((n) => n.text)
      .join('');
    expect(fullText).toContain('Cost is $10 and $20 today, or $10-$20, vs valid ');

    // Single-line `$$E = mc^2$$` is preserved as `mathBlock`, not downgraded to `$E = mc^2$`
    expect(pmDoc.content?.[1]).toEqual({
      type: 'mathBlock',
      attrs: { latex: 'E = mc^2' },
    });

    // Empty mathInline never emits bare `$$`
    const emptyInlineMathDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'mathInline', attrs: { latex: '   ' } },
            { type: 'text', text: 'world' },
          ],
        },
      ],
    };
    expect(proseMirrorDocToMarkdown(emptyInlineMathDoc)).toBe('Hello world\n');
  });

  it('extracts outline headings across containers and computes Base64-clean document stats', () => {
    const bigBase64 = 'A'.repeat(20_000);
    const md = `# Intro

> ## Quoted Heading

> [!NOTE]
> ### Alert Heading

- #### List Heading

#

## Final Heading

![shot](data:image/png;base64,${bigBase64})
`;

    const outline = extractHeadingsOutline(md);
    expect(outline.map((h) => ({ id: h.id, level: h.level, text: h.text }))).toEqual([
      { id: 'heading-0', level: 1, text: 'Intro' },
      { id: 'heading-1', level: 2, text: 'Quoted Heading' },
      { id: 'heading-2', level: 3, text: 'Alert Heading' },
      { id: 'heading-3', level: 4, text: 'List Heading' },
      { id: 'heading-4', level: 2, text: 'Final Heading' },
    ]);

    const stats = computeDocumentStats(md);
    expect(stats.chars).toBeLessThan(200);
    expect(stats.words).toBeGreaterThanOrEqual(10);
    expect(stats.words).toBeLessThan(20);
    expect(stats.readingMinutes).toBe(1);
  });

  it('strips trailing backslashes in sanitizeImageAlt so closing bracket is never escaped', () => {
    expect(sanitizeImageAlt('folder\\bad\\.png')).toBe('folder\\bad');
    expect(sanitizeImageAlt('trail\\\\   .jpg')).toBe('trail');
    expect(sanitizeImageAlt('\\\\.png', 'image')).toBe('image');
    expect(sanitizeImageAlt(undefined, 'image')).toBe('image');
    expect(sanitizeImageAlt(undefined)).toBe('imagen');
  });
});
