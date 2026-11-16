import type { JSONContent } from '@tiptap/core';
import type {
  AlignType,
  BlockContent,
  Blockquote,
  Code,
  DefinitionContent,
  Heading,
  Html,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Table,
  TableCell,
  TableRow,
} from 'mdast';
import { toString as mdastToString } from 'mdast-util-to-string';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import type { GithubAlertKind } from '../i18n/types';

export interface OutlineHeading {
  id: string;
  level: number;
  text: string;
  line: number;
}

type MarkEntry = { type: string; attrs?: Record<string, unknown> };

interface MathBlockMdast {
  type: 'math';
  value: string;
  meta?: string | null;
}

interface InlineMathMdast {
  type: 'inlineMath';
  value: string;
}

interface YamlMdast {
  type: 'yaml';
  value: string;
}

type ExtendedRootContent = RootContent | MathBlockMdast | YamlMdast;
type ExtendedPhrasingContent = PhrasingContent | InlineMathMdast;

const parser = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkGfm)
  .use(remarkMath);

const stringifier = unified()
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkGfm, { tablePipeAlign: true })
  .use(remarkMath)
  .use(remarkStringify, {
    bullet: '-',
    fences: true,
    listItemIndent: 'one',
    rule: '-',
    emphasis: '*',
    strong: '*',
  });

const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:[ \t]*(?:\r?\n|$)|[ \t]+)/i;

function normalizeAlertKind(raw: string): GithubAlertKind {
  const upper = raw.toUpperCase();
  if (upper === 'TIP' || upper === 'IMPORTANT' || upper === 'WARNING' || upper === 'CAUTION') {
    return upper;
  }
  return 'NOTE';
}

function normalizeTextValue(value: string): string {
  return value.replace(/\r?\n/g, ' ');
}

function mergeAdjacentTextNodes(nodes: JSONContent[]): JSONContent[] {
  const result: JSONContent[] = [];
  for (const node of nodes) {
    if (node.type === 'text' && (!node.text || node.text.length === 0)) {
      continue;
    }
    const prev = result[result.length - 1];
    if (
      prev &&
      prev.type === 'text' &&
      node.type === 'text' &&
      JSON.stringify(prev.marks ?? []) === JSON.stringify(node.marks ?? [])
    ) {
      prev.text = (prev.text ?? '') + (node.text ?? '');
    } else {
      result.push(node);
    }
  }
  return result;
}

function mdastPhrasingToPM(
  nodes: ExtendedPhrasingContent[],
  activeMarks: MarkEntry[] = [],
): JSONContent[] {
  const out: JSONContent[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case 'text': {
        const text = normalizeTextValue(node.value);
        if (text.length > 0) {
          out.push(
            activeMarks.length > 0
              ? { type: 'text', text, marks: activeMarks.map((m) => ({ ...m })) }
              : { type: 'text', text },
          );
        }
        break;
      }
      case 'strong': {
        out.push(...mdastPhrasingToPM(node.children as ExtendedPhrasingContent[], [...activeMarks, { type: 'bold' }]));
        break;
      }
      case 'emphasis': {
        out.push(...mdastPhrasingToPM(node.children as ExtendedPhrasingContent[], [...activeMarks, { type: 'italic' }]));
        break;
      }
      case 'delete': {
        out.push(...mdastPhrasingToPM(node.children as ExtendedPhrasingContent[], [...activeMarks, { type: 'strike' }]));
        break;
      }
      case 'inlineCode': {
        if (node.value.length > 0) {
          out.push({
            type: 'text',
            text: node.value,
            marks: [...activeMarks.map((m) => ({ ...m })), { type: 'code' }],
          });
        }
        break;
      }
      case 'link': {
        const linkMark: MarkEntry = {
          type: 'link',
          attrs: {
            href: node.url,
            target: '_blank',
            title: node.title ?? null,
          },
        };
        out.push(...mdastPhrasingToPM(node.children as ExtendedPhrasingContent[], [...activeMarks, linkMark]));
        break;
      }
      case 'image': {
        out.push({
          type: 'image',
          attrs: {
            src: node.url,
            alt: node.alt ?? '',
            title: node.title ?? null,
          },
        });
        break;
      }
      case 'break': {
        out.push({ type: 'hardBreak' });
        break;
      }
      case 'inlineMath': {
        out.push({
          type: 'mathInline',
          attrs: { latex: node.value ?? '' },
        });
        break;
      }
      case 'html': {
        if (node.value.trim().length > 0) {
          out.push({
            type: 'rawHtmlInline',
            attrs: { value: node.value },
          });
        }
        break;
      }
      default: {
        const fallbackText = mdastToString(node as never);
        if (fallbackText) {
          out.push(
            activeMarks.length > 0
              ? { type: 'text', text: fallbackText, marks: activeMarks.map((m) => ({ ...m })) }
              : { type: 'text', text: fallbackText },
          );
        }
        break;
      }
    }
  }

  return mergeAdjacentTextNodes(out);
}

function tryExtractGithubAlert(node: Blockquote): JSONContent | null {
  if (!node.children || node.children.length === 0) return null;
  const firstChild = node.children[0];
  if (firstChild.type !== 'paragraph' || firstChild.children.length === 0) return null;

  const firstInline = firstChild.children[0];
  if (firstInline.type !== 'text') return null;

  const match = firstInline.value.match(ALERT_RE);
  if (!match) return null;

  const alertType = normalizeAlertKind(match[1]);
  const remainingFirstText = firstInline.value.slice(match[0].length);

  const restFirstInline = [
    ...(remainingFirstText.length > 0 ? [{ ...firstInline, value: remainingFirstText }] : []),
    ...firstChild.children.slice(1),
  ];

  // If the first node after marker was a hardBreak (<br>), drop leading break cleanly
  if (restFirstInline.length > 0 && restFirstInline[0].type === 'break') {
    restFirstInline.shift();
  }

  const remainingBlocks: ExtendedRootContent[] = [];
  if (restFirstInline.length > 0) {
    remainingBlocks.push({
      type: 'paragraph',
      children: restFirstInline,
    });
  }
  remainingBlocks.push(...(node.children.slice(1) as ExtendedRootContent[]));

  const pmContent = remainingBlocks.flatMap((child) => mdastBlockToPM(child));
  return {
    type: 'githubAlert',
    attrs: { alertType },
    content: pmContent.length > 0 ? pmContent : [{ type: 'paragraph' }],
  };
}

function mdastListItemToBlocks(item: ListItem): JSONContent[] {
  const blocks: JSONContent[] = [];
  for (const child of item.children) {
    blocks.push(...mdastBlockToPM(child as ExtendedRootContent));
  }
  if (blocks.length === 0) {
    blocks.push({ type: 'paragraph' });
  }
  // TipTap listItem / taskItem requires paragraph first
  if (blocks[0].type !== 'paragraph') {
    blocks.unshift({ type: 'paragraph' });
  }
  return blocks;
}

function mdastTableToPM(node: Table): JSONContent {
  const aligns = node.align ?? [];
  const rows: JSONContent[] = node.children.map((row: TableRow, rowIndex: number) => {
    const isHeaderRow = rowIndex === 0;
    const cells: JSONContent[] = row.children.map((cell: TableCell, colIndex: number) => {
      const inlineContent = mdastPhrasingToPM(cell.children as ExtendedPhrasingContent[]);
      const textAlign = aligns[colIndex] ?? null;
      return {
        type: isHeaderRow ? 'tableHeader' : 'tableCell',
        attrs: {
          colspan: 1,
          rowspan: 1,
          colwidth: null,
          textAlign,
        },
        content: [
          inlineContent.length > 0
            ? { type: 'paragraph', content: inlineContent }
            : { type: 'paragraph' },
        ],
      };
    });
    return {
      type: 'tableRow',
      content: cells,
    };
  });

  return {
    type: 'table',
    content: rows,
  };
}

function mdastBlockToPM(node: ExtendedRootContent): JSONContent[] {
  switch (node.type) {
    case 'yaml': {
      return [
        {
          type: 'frontmatter',
          attrs: { value: node.value ?? '' },
        },
      ];
    }
    case 'heading': {
      const level = Math.min(6, Math.max(1, node.depth || 1));
      const content = mdastPhrasingToPM(node.children as ExtendedPhrasingContent[]);
      return [
        content.length > 0
          ? { type: 'heading', attrs: { level }, content }
          : { type: 'heading', attrs: { level } },
      ];
    }
    case 'paragraph': {
      const content = mdastPhrasingToPM(node.children as ExtendedPhrasingContent[]);
      return [content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }];
    }
    case 'blockquote': {
      const alertNode = tryExtractGithubAlert(node);
      if (alertNode) return [alertNode];
      const content = (node.children as ExtendedRootContent[]).flatMap((c) => mdastBlockToPM(c));
      return [
        {
          type: 'blockquote',
          content: content.length > 0 ? content : [{ type: 'paragraph' }],
        },
      ];
    }
    case 'code': {
      const lang = (node.lang ?? '').trim();
      if (lang.toLowerCase() === 'mermaid') {
        return [
          {
            type: 'mermaidBlock',
            attrs: { code: node.value ?? '' },
          },
        ];
      }
      return [
        {
          type: 'codeBlock',
          attrs: { language: lang || null },
          content: node.value ? [{ type: 'text', text: node.value }] : [],
        },
      ];
    }
    case 'math': {
      return [
        {
          type: 'mathBlock',
          attrs: { latex: node.value ?? '' },
        },
      ];
    }
    case 'list': {
      if (node.ordered) {
        return [
          {
            type: 'orderedList',
            attrs: { start: node.start ?? 1 },
            content: node.children.map((li) => ({
              type: 'listItem',
              content: mdastListItemToBlocks(li),
            })),
          },
        ];
      }

      const lists: JSONContent[] = [];
      let currentBucket: { isTask: boolean; items: ListItem[] } | null = null;
      for (const li of node.children) {
        const isTask = typeof li.checked === 'boolean';
        if (!currentBucket || currentBucket.isTask !== isTask) {
          currentBucket = { isTask, items: [li] };
          lists.push(currentBucket as unknown as JSONContent);
        } else {
          currentBucket.items.push(li);
        }
      }

      return lists.map((bucket) => {
        const typed = bucket as unknown as { isTask: boolean; items: ListItem[] };
        if (typed.isTask) {
          return {
            type: 'taskList',
            content: typed.items.map((li) => ({
              type: 'taskItem',
              attrs: { checked: Boolean(li.checked) },
              content: mdastListItemToBlocks(li),
            })),
          };
        }
        return {
          type: 'bulletList',
          content: typed.items.map((li) => ({
            type: 'listItem',
            content: mdastListItemToBlocks(li),
          })),
        };
      });
    }
    case 'table': {
      return [mdastTableToPM(node)];
    }
    case 'thematicBreak': {
      return [{ type: 'horizontalRule' }];
    }
    case 'html': {
      return [
        {
          type: 'rawHtmlBlock',
          attrs: { value: node.value ?? '' },
        },
      ];
    }
    case 'definition': {
      return [];
    }
    default: {
      const text = mdastToString(node as never);
      return text ? [{ type: 'paragraph', content: [{ type: 'text', text }] }] : [];
    }
  }
}

export function markdownToProseMirrorDoc(markdown: string): JSONContent {
  if (!markdown || markdown.trim().length === 0) {
    return {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    };
  }

  const tree = parser.parse(markdown) as Root;
  const content = (tree.children as ExtendedRootContent[]).flatMap((node) => mdastBlockToPM(node));

  return {
    type: 'doc',
    content: content.length > 0 ? content : [{ type: 'paragraph' }],
  };
}

function wrapWithMark(child: PhrasingContent, mark: MarkEntry): PhrasingContent {
  switch (mark.type) {
    case 'bold':
      return { type: 'strong', children: [child] };
    case 'italic':
      return { type: 'emphasis', children: [child] };
    case 'strike':
      return { type: 'delete', children: [child] };
    case 'link':
      return {
        type: 'link',
        url: String(mark.attrs?.href ?? ''),
        title: typeof mark.attrs?.title === 'string' && mark.attrs.title.length > 0 ? mark.attrs.title : undefined,
        children: [child],
      };
    default:
      return child;
  }
}

function pmInlineToMdast(nodes: JSONContent[] | undefined): ExtendedPhrasingContent[] {
  if (!nodes || nodes.length === 0) return [];
  const out: ExtendedPhrasingContent[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case 'text': {
        const text = node.text ?? '';
        if (!text) break;
        const marks = (node.marks ?? []) as MarkEntry[];
        const hasCode = marks.some((m) => m.type === 'code');
        let current: PhrasingContent = hasCode
          ? { type: 'inlineCode', value: text }
          : { type: 'text', value: text };

        // Apply non-code marks from inner to outer
        for (let i = marks.length - 1; i >= 0; i -= 1) {
          if (marks[i].type === 'code') continue;
          current = wrapWithMark(current, marks[i]);
        }
        out.push(current);
        break;
      }
      case 'hardBreak': {
        out.push({ type: 'break' });
        break;
      }
      case 'image': {
        out.push({
          type: 'image',
          url: String(node.attrs?.src ?? ''),
          alt: typeof node.attrs?.alt === 'string' ? node.attrs.alt : '',
          title: typeof node.attrs?.title === 'string' && node.attrs.title.length > 0 ? node.attrs.title : undefined,
        });
        break;
      }
      case 'mathInline': {
        out.push({
          type: 'inlineMath',
          value: String(node.attrs?.latex ?? ''),
        });
        break;
      }
      case 'rawHtmlInline': {
        out.push({
          type: 'html',
          value: String(node.attrs?.value ?? ''),
        });
        break;
      }
      default:
        break;
    }
  }

  return out;
}

function pmListToMdast(node: JSONContent, ordered: boolean, taskList: boolean): List {
  const items: ListItem[] = (node.content ?? []).map((item) => {
    const childBlocks = (item.content ?? []).flatMap((block) => pmBlockToMdast(block));
    return {
      type: 'listItem',
      spread: false,
      checked: taskList ? Boolean(item.attrs?.checked) : null,
      children: (childBlocks.length > 0 ? childBlocks : [{ type: 'paragraph', children: [] }]) as Array<
        BlockContent | DefinitionContent
      >,
    };
  });

  return {
    type: 'list',
    ordered,
    start: ordered ? Number(node.attrs?.start ?? 1) : null,
    spread: false,
    children: items,
  };
}

function pmTableToMdast(node: JSONContent): Table {
  const pmRows = node.content ?? [];
  const colCount = pmRows.reduce((max, row) => Math.max(max, row.content?.length ?? 0), 0);
  const align: AlignType[] = Array.from({ length: colCount }, () => null);

  const mdRows: TableRow[] = pmRows.map((row, rowIndex) => {
    const cells: TableCell[] = (row.content ?? []).map((cell, colIndex) => {
      const cellAlign = cell.attrs?.textAlign as AlignType | undefined;
      if (rowIndex === 0 && (cellAlign === 'left' || cellAlign === 'center' || cellAlign === 'right')) {
        align[colIndex] = cellAlign;
      } else if (align[colIndex] === null && (cellAlign === 'left' || cellAlign === 'center' || cellAlign === 'right')) {
        align[colIndex] = cellAlign;
      }

      const inlineChildren: PhrasingContent[] = [];
      for (const block of cell.content ?? []) {
        if (inlineChildren.length > 0) {
          inlineChildren.push({ type: 'text', value: ' ' });
        }
        inlineChildren.push(...(pmInlineToMdast(block.content) as PhrasingContent[]));
      }

      return {
        type: 'tableCell',
        children: inlineChildren,
      };
    });

    return {
      type: 'tableRow',
      children: cells,
    };
  });

  return {
    type: 'table',
    align,
    children: mdRows,
  };
}

function pmBlockToMdast(node: JSONContent): ExtendedRootContent[] {
  switch (node.type) {
    case 'frontmatter': {
      const raw = String(node.attrs?.value ?? '').trim();
      return raw.length > 0 ? [{ type: 'yaml', value: raw }] : [];
    }
    case 'heading': {
      const depth = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1))) as Heading['depth'];
      return [
        {
          type: 'heading',
          depth,
          children: pmInlineToMdast(node.content) as PhrasingContent[],
        },
      ];
    }
    case 'paragraph': {
      return [
        {
          type: 'paragraph',
          children: pmInlineToMdast(node.content) as PhrasingContent[],
        },
      ];
    }
    case 'blockquote': {
      const children = (node.content ?? []).flatMap((c) => pmBlockToMdast(c));
      return [
        {
          type: 'blockquote',
          children: (children.length > 0 ? children : [{ type: 'paragraph', children: [] }]) as Array<
            BlockContent | DefinitionContent
          >,
        },
      ];
    }
    case 'githubAlert': {
      const alertType = normalizeAlertKind(String(node.attrs?.alertType ?? 'NOTE'));
      const innerBlocks = (node.content ?? []).flatMap((c) => pmBlockToMdast(c));

      if (innerBlocks.length > 0 && innerBlocks[0].type === 'paragraph') {
        const firstPara = innerBlocks[0] as Paragraph;
        const markerNode: Html = { type: 'html', value: `[!${alertType}]\n` };
        innerBlocks[0] = {
          type: 'paragraph',
          children: [markerNode, ...firstPara.children],
        };
      } else {
        innerBlocks.unshift({
          type: 'paragraph',
          children: [{ type: 'html', value: `[!${alertType}]` }],
        });
      }

      return [
        {
          type: 'blockquote',
          children: innerBlocks as Array<BlockContent | DefinitionContent>,
        },
      ];
    }
    case 'codeBlock': {
      const lang = typeof node.attrs?.language === 'string' && node.attrs.language.length > 0 ? node.attrs.language : null;
      const value = (node.content ?? []).map((c) => c.text ?? '').join('');
      const codeNode: Code = {
        type: 'code',
        lang,
        meta: null,
        value,
      };
      return [codeNode];
    }
    case 'mermaidBlock': {
      return [
        {
          type: 'code',
          lang: 'mermaid',
          meta: null,
          value: String(node.attrs?.code ?? ''),
        },
      ];
    }
    case 'mathBlock': {
      return [
        {
          type: 'math',
          value: String(node.attrs?.latex ?? ''),
        },
      ];
    }
    case 'bulletList':
      return [pmListToMdast(node, false, false)];
    case 'orderedList':
      return [pmListToMdast(node, true, false)];
    case 'taskList':
      return [pmListToMdast(node, false, true)];
    case 'table':
      return [pmTableToMdast(node)];
    case 'horizontalRule':
      return [{ type: 'thematicBreak' }];
    case 'rawHtmlBlock':
      return [{ type: 'html', value: String(node.attrs?.value ?? '') }];
    default:
      return [];
  }
}

export function proseMirrorDocToMarkdown(doc: JSONContent): string {
  const children = (doc.content ?? []).flatMap((node) => pmBlockToMdast(node));
  const root: Root = {
    type: 'root',
    children: children as RootContent[],
  };
  const out = stringifier.stringify(root);
  return out.replace(/\n{3,}/g, '\n\n').trimEnd() + (out.length > 0 ? '\n' : '');
}

export function extractHeadingsOutline(markdown: string): OutlineHeading[] {
  if (!markdown || markdown.trim().length === 0) return [];
  const tree = parser.parse(markdown) as Root;
  const headings: OutlineHeading[] = [];
  let index = 0;

  for (const node of tree.children) {
    if (node.type === 'heading') {
      const text = mdastToString(node).trim();
      if (text.length > 0) {
        headings.push({
          id: `heading-${index++}`,
          level: node.depth,
          text,
          line: node.position?.start.line ?? 1,
        });
      }
    }
  }

  return headings;
}

export function computeDocumentStats(markdown: string): {
  words: number;
  chars: number;
  readingMinutes: number;
} {
  const chars = markdown.length;
  const cleanText = markdown
    .replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, ' image ')
    .replace(/```[\s\S]*?```/g, (m) => m)
    .trim();
  const words = cleanText.length === 0 ? 0 : cleanText.split(/\s+/).filter(Boolean).length;
  const readingMinutes = Math.max(1, Math.ceil(words / 200));
  return { words, chars, readingMinutes: words === 0 ? 0 : readingMinutes };
}
