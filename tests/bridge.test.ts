import { describe, expect, it } from 'vitest';
import {
  computeDocumentStats,
  extractHeadingsOutline,
  markdownToProseMirrorDoc,
  proseMirrorDocToMarkdown,
} from '../src/markdown/bridge';

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

  it('extracts outline headings and document stats accurately', () => {
    const md = `# Intro\n\nSome words here.\n\n## Details\n\n### Sub\n`;
    const outline = extractHeadingsOutline(md);
    expect(outline).toHaveLength(3);
    expect(outline[0]).toMatchObject({ level: 1, text: 'Intro', line: 1 });
    expect(outline[1]).toMatchObject({ level: 2, text: 'Details', line: 5 });
    expect(outline[2]).toMatchObject({ level: 3, text: 'Sub', line: 7 });

    const stats = computeDocumentStats(md);
    expect(stats.words).toBeGreaterThan(5);
    expect(stats.readingMinutes).toBe(1);
  });
});
