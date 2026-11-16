import type { JSONContent } from '@tiptap/core';
import type {
  AlignType,
  BlockContent,
  Blockquote,
  Code,
  Definition,
  DefinitionContent,
  FootnoteDefinition,
  FootnoteReference,
  Heading,
  Html,
  ImageReference,
  LinkReference,
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
  position?: {
    start: { line: number; column: number; offset?: number };
    end: { line: number; column: number; offset?: number };
  };
}

interface YamlMdast {
  type: 'yaml';
  value: string;
}

type ExtendedRootContent = RootContent | MathBlockMdast | YamlMdast;
type ExtendedPhrasingContent = PhrasingContent | InlineMathMdast;

interface ParseContext {
  markdown: string;
  definitions: Map<string, Definition>;
  usedDefinitions: Set<string>;
}

const parser = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkGfm)
  .use(remarkMath, { singleDollarTextMath: true });

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
const BR_TAG_RE = /^<br\s*\/?>$/i;
const EMPTY_TASK_MARKER_RE = /^\[([ xX])\]$/;
const FOOTNOTE_REF_TEXT_RE = /^\[\^([^\]]+)\]$/;
const FOOTNOTE_DEF_MARKER_RE = /^\[\^([^\]]+)\]:$/;
const DATA_URI_STRIP_RE = /data:image\/[^)\s"'>]+/gi;
const DATA_URI_FAST_OUTLINE_RE = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]{64,}/g;

const SUPPORTED_OUTER_MARKS = new Set(['link', 'bold', 'italic', 'strike']);
const MARK_PRIORITY: Record<string, number> = {
  link: 0,
  bold: 1,
  italic: 2,
  strike: 3,
};

function normalizeAlertKind(raw: string): GithubAlertKind {
  const upper = raw.toUpperCase();
  if (upper === 'TIP' || upper === 'IMPORTANT' || upper === 'WARNING' || upper === 'CAUTION') {
    return upper;
  }
  return 'NOTE';
}

function normalizeRefId(id: string | null | undefined): string {
  return (id ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function cloneMark(mark: MarkEntry): MarkEntry {
  return mark.attrs ? { type: mark.type, attrs: { ...mark.attrs } } : { type: mark.type };
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

function mergeAdjacentMdastText(nodes: ExtendedPhrasingContent[]): ExtendedPhrasingContent[] {
  const out: ExtendedPhrasingContent[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      if (!node.value) continue;
      const prev = out[out.length - 1];
      if (prev && prev.type === 'text') {
        prev.value += node.value;
        continue;
      }
    }
    out.push(node);
  }
  return out;
}

function isCurrencyInlineMath(rawSlice: string, afterChar: string): boolean {
  if (rawSlice.startsWith('$$')) return false;
  if (!rawSlice.startsWith('$') || !rawSlice.endsWith('$') || rawSlice.length < 2) return false;
  const inner = rawSlice.slice(1, -1);
  if (inner.length === 0) return false;

  // Closing `$` immediately followed by a digit (e.g. `$10 and $20`, `$10-$20`, `$5/$10`)
  if (/^\d/.test(afterChar)) {
    return true;
  }

  // Starts with digit right after `$` and ends with unescaped whitespace before closing `$`
  if (/^\d/.test(inner) && /\s$/.test(inner) && !/\\$/.test(inner.trimEnd())) {
    return true;
  }

  // Multi-line single-dollar span starting with a digit (e.g. `$10.\nNext: $20`)
  if (/^\d/.test(inner) && /\r?\n/.test(inner)) {
    return true;
  }

  return false;
}

function normalizeParsedPhrasing(
  children: ExtendedPhrasingContent[],
  markdown: string,
): ExtendedPhrasingContent[] {
  let mutated = false;
  const transformed: ExtendedPhrasingContent[] = [];

  for (let i = 0; i < children.length; i += 1) {
    const node = children[i];
    if (node.type === 'inlineMath') {
      const startOffset = node.position?.start.offset;
      const endOffset = node.position?.end.offset;
      const rawSlice =
        typeof startOffset === 'number' && typeof endOffset === 'number'
          ? markdown.slice(startOffset, endOffset)
          : `$${node.value ?? ''}$`;
      const nextSibling = children[i + 1];
      const afterChar =
        typeof endOffset === 'number'
          ? (markdown[endOffset] ?? '')
          : nextSibling?.type === 'text'
            ? (nextSibling.value[0] ?? '')
            : '';

      if (isCurrencyInlineMath(rawSlice, afterChar)) {
        mutated = true;
        transformed.push({ type: 'text', value: rawSlice });
        continue;
      }
    } else if (
      node.type === 'strong' ||
      node.type === 'emphasis' ||
      node.type === 'delete' ||
      node.type === 'link' ||
      node.type === 'linkReference'
    ) {
      node.children = normalizeParsedPhrasing(
        node.children as ExtendedPhrasingContent[],
        markdown,
      ) as never;
    }
    transformed.push(node);
  }

  return mutated ? mergeAdjacentMdastText(transformed) : transformed;
}

function prepareMdastTree(tree: Root, markdown: string): ParseContext {
  const definitions = new Map<string, Definition>();
  const usedDefinitions = new Set<string>();

  const collectDefs = (nodes: ExtendedRootContent[]) => {
    for (const node of nodes) {
      if (node.type === 'definition') {
        const key = normalizeRefId(node.identifier);
        if (key && !definitions.has(key)) {
          definitions.set(key, node);
        }
      } else if (node.type === 'blockquote' || node.type === 'footnoteDefinition') {
        collectDefs(node.children as ExtendedRootContent[]);
      } else if (node.type === 'list') {
        for (const li of node.children) {
          collectDefs(li.children as ExtendedRootContent[]);
        }
      }
    }
  };

  collectDefs(tree.children as ExtendedRootContent[]);

  const markUsedRefsInPhrasing = (nodes: ExtendedPhrasingContent[]) => {
    for (const n of nodes) {
      if (n.type === 'linkReference' || n.type === 'imageReference') {
        const key = normalizeRefId(n.identifier);
        if (definitions.has(key)) {
          usedDefinitions.add(key);
        }
        if (n.type === 'linkReference') {
          markUsedRefsInPhrasing(n.children as ExtendedPhrasingContent[]);
        }
      } else if (
        n.type === 'strong' ||
        n.type === 'emphasis' ||
        n.type === 'delete' ||
        n.type === 'link'
      ) {
        markUsedRefsInPhrasing(n.children as ExtendedPhrasingContent[]);
      }
    }
  };

  const normalizeBlocks = (nodes: ExtendedRootContent[]) => {
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (node.type === 'paragraph') {
        // Promote standalone single-line `$$...$$` paragraphs to `math` blocks
        if (node.children.length === 1 && (node.children[0] as ExtendedPhrasingContent).type === 'inlineMath') {
          const mathChild = node.children[0] as unknown as InlineMathMdast;
          const s = mathChild.position?.start.offset;
          const e = mathChild.position?.end.offset;
          if (typeof s === 'number' && typeof e === 'number') {
            const raw = markdown.slice(s, e);
            if (raw.startsWith('$$') && raw.endsWith('$$') && raw.length >= 4) {
              nodes[i] = {
                type: 'math',
                value: mathChild.value ?? '',
              };
              continue;
            }
          }
        }
        node.children = normalizeParsedPhrasing(
          node.children as ExtendedPhrasingContent[],
          markdown,
        ) as PhrasingContent[];
        markUsedRefsInPhrasing(node.children as ExtendedPhrasingContent[]);
      } else if (node.type === 'heading') {
        node.children = normalizeParsedPhrasing(
          node.children as ExtendedPhrasingContent[],
          markdown,
        ) as PhrasingContent[];
        markUsedRefsInPhrasing(node.children as ExtendedPhrasingContent[]);
      } else if (node.type === 'table') {
        for (const row of node.children) {
          for (const cell of row.children) {
            cell.children = normalizeParsedPhrasing(
              cell.children as ExtendedPhrasingContent[],
              markdown,
            ) as PhrasingContent[];
            markUsedRefsInPhrasing(cell.children as ExtendedPhrasingContent[]);
          }
        }
      } else if (node.type === 'blockquote' || node.type === 'footnoteDefinition') {
        normalizeBlocks(node.children as ExtendedRootContent[]);
      } else if (node.type === 'list') {
        for (const li of node.children) {
          normalizeBlocks(li.children as ExtendedRootContent[]);
        }
      }
    }
  };

  normalizeBlocks(tree.children as ExtendedRootContent[]);

  return { markdown, definitions, usedDefinitions };
}

function formatDefinitionLine(node: Definition): string {
  const label = node.label || node.identifier;
  const needsAngles = !node.url || /\s/.test(node.url);
  const urlPart = needsAngles ? `<${node.url}>` : node.url;
  const titlePart = node.title ? ` ${JSON.stringify(node.title)}` : '';
  return `[${label}]: ${urlPart}${titlePart}`;
}

function mdastPhrasingToPM(
  nodes: ExtendedPhrasingContent[],
  ctx: ParseContext,
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
              ? { type: 'text', text, marks: activeMarks.map(cloneMark) }
              : { type: 'text', text },
          );
        }
        break;
      }
      case 'strong': {
        out.push(
          ...mdastPhrasingToPM(node.children as ExtendedPhrasingContent[], ctx, [
            ...activeMarks,
            { type: 'bold' },
          ]),
        );
        break;
      }
      case 'emphasis': {
        out.push(
          ...mdastPhrasingToPM(node.children as ExtendedPhrasingContent[], ctx, [
            ...activeMarks,
            { type: 'italic' },
          ]),
        );
        break;
      }
      case 'delete': {
        out.push(
          ...mdastPhrasingToPM(node.children as ExtendedPhrasingContent[], ctx, [
            ...activeMarks,
            { type: 'strike' },
          ]),
        );
        break;
      }
      case 'inlineCode': {
        if (node.value.length > 0) {
          out.push({
            type: 'text',
            text: node.value,
            marks: [...activeMarks.map(cloneMark), { type: 'code' }],
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
        out.push(
          ...mdastPhrasingToPM(node.children as ExtendedPhrasingContent[], ctx, [
            ...activeMarks,
            linkMark,
          ]),
        );
        break;
      }
      case 'linkReference': {
        const refNode = node as LinkReference;
        const def = ctx.definitions.get(normalizeRefId(refNode.identifier));
        if (def) {
          const linkMark: MarkEntry = {
            type: 'link',
            attrs: {
              href: def.url,
              target: '_blank',
              title: def.title ?? null,
            },
          };
          out.push(
            ...mdastPhrasingToPM(refNode.children as ExtendedPhrasingContent[], ctx, [
              ...activeMarks,
              linkMark,
            ]),
          );
        } else {
          const inner = mdastPhrasingToPM(
            refNode.children as ExtendedPhrasingContent[],
            ctx,
            activeMarks,
          );
          const suffix =
            refNode.referenceType === 'collapsed'
              ? '][]'
              : refNode.referenceType === 'full'
                ? `][${refNode.label || refNode.identifier}]`
                : ']';
          const marks = activeMarks.length > 0 ? activeMarks.map(cloneMark) : undefined;
          out.push(
            marks ? { type: 'text', text: '[', marks } : { type: 'text', text: '[' },
            ...inner,
            marks
              ? { type: 'text', text: suffix, marks: marks.map(cloneMark) }
              : { type: 'text', text: suffix },
          );
        }
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
          ...(activeMarks.length > 0 ? { marks: activeMarks.map(cloneMark) } : {}),
        });
        break;
      }
      case 'imageReference': {
        const imgRef = node as ImageReference;
        const def = ctx.definitions.get(normalizeRefId(imgRef.identifier));
        if (def) {
          out.push({
            type: 'image',
            attrs: {
              src: def.url,
              alt: imgRef.alt ?? '',
              title: def.title ?? null,
            },
            ...(activeMarks.length > 0 ? { marks: activeMarks.map(cloneMark) } : {}),
          });
        } else {
          const suffix =
            imgRef.referenceType === 'collapsed'
              ? '][]'
              : imgRef.referenceType === 'full'
                ? `][${imgRef.label || imgRef.identifier}]`
                : ']';
          const fallback = `![${imgRef.alt ?? ''}${suffix}`;
          out.push(
            activeMarks.length > 0
              ? { type: 'text', text: fallback, marks: activeMarks.map(cloneMark) }
              : { type: 'text', text: fallback },
          );
        }
        break;
      }
      case 'footnoteReference': {
        const fnRef = node as FootnoteReference;
        const label = fnRef.label || fnRef.identifier;
        const fnMark: MarkEntry = {
          type: 'link',
          attrs: {
            href: `#fn-${encodeURIComponent(fnRef.identifier)}`,
            target: '_blank',
            title: null,
          },
        };
        out.push({
          type: 'text',
          text: `[^${label}]`,
          marks: [...activeMarks.map(cloneMark), fnMark],
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
          ...(activeMarks.length > 0 ? { marks: activeMarks.map(cloneMark) } : {}),
        });
        break;
      }
      case 'html': {
        const trimmed = node.value.trim();
        if (BR_TAG_RE.test(trimmed)) {
          out.push({ type: 'hardBreak' });
        } else if (trimmed.length > 0) {
          out.push({
            type: 'rawHtmlInline',
            attrs: { value: node.value },
            ...(activeMarks.length > 0 ? { marks: activeMarks.map(cloneMark) } : {}),
          });
        }
        break;
      }
      default: {
        const fallbackText = mdastToString(node as never);
        if (fallbackText) {
          out.push(
            activeMarks.length > 0
              ? { type: 'text', text: fallbackText, marks: activeMarks.map(cloneMark) }
              : { type: 'text', text: fallbackText },
          );
        }
        break;
      }
    }
  }

  return mergeAdjacentTextNodes(out);
}

function tryExtractGithubAlert(node: Blockquote, ctx: ParseContext): JSONContent | null {
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

  const pmContent = remainingBlocks.flatMap((child) => mdastBlockToPM(child, ctx));
  return {
    type: 'githubAlert',
    attrs: { alertType },
    content: pmContent.length > 0 ? pmContent : [{ type: 'paragraph' }],
  };
}

function inspectListItemTaskState(item: ListItem): {
  isTask: boolean;
  checked: boolean;
  strippedEmptyMarker: boolean;
} {
  if (typeof item.checked === 'boolean') {
    return { isTask: true, checked: item.checked, strippedEmptyMarker: false };
  }
  if (
    item.children.length === 1 &&
    item.children[0].type === 'paragraph' &&
    item.children[0].children.length === 1 &&
    item.children[0].children[0].type === 'text'
  ) {
    const m = item.children[0].children[0].value.match(EMPTY_TASK_MARKER_RE);
    if (m) {
      return {
        isTask: true,
        checked: m[1].toLowerCase() === 'x',
        strippedEmptyMarker: true,
      };
    }
  }
  return { isTask: false, checked: false, strippedEmptyMarker: false };
}

function mdastListItemToBlocks(
  item: ListItem,
  ctx: ParseContext,
  strippedEmptyMarker = false,
): JSONContent[] {
  if (strippedEmptyMarker) {
    return [{ type: 'paragraph' }];
  }
  const blocks: JSONContent[] = [];
  for (const child of item.children) {
    blocks.push(...mdastBlockToPM(child as ExtendedRootContent, ctx));
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

function splitCellPhrasingByBr(nodes: ExtendedPhrasingContent[]): ExtendedPhrasingContent[][] {
  const segments: ExtendedPhrasingContent[][] = [[]];
  for (const node of nodes) {
    if (node.type === 'html' && BR_TAG_RE.test(node.value.trim())) {
      segments.push([]);
    } else {
      segments[segments.length - 1].push(node);
    }
  }
  return segments;
}

function mdastTableToPM(node: Table, ctx: ParseContext): JSONContent {
  const aligns = node.align ?? [];
  const rows: JSONContent[] = node.children.map((row: TableRow, rowIndex: number) => {
    const isHeaderRow = rowIndex === 0;
    const cells: JSONContent[] = row.children.map((cell: TableCell, colIndex: number) => {
      const segments = splitCellPhrasingByBr(cell.children as ExtendedPhrasingContent[]);
      const paragraphs: JSONContent[] = segments.map((seg) => {
        const inlineContent = mdastPhrasingToPM(seg, ctx);
        return inlineContent.length > 0 ? { type: 'paragraph', content: inlineContent } : { type: 'paragraph' };
      });
      const textAlign = aligns[colIndex] ?? null;
      return {
        type: isHeaderRow ? 'tableHeader' : 'tableCell',
        attrs: {
          colspan: 1,
          rowspan: 1,
          colwidth: null,
          textAlign,
        },
        content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph' }],
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

function mdastFootnoteDefinitionToPM(node: FootnoteDefinition, ctx: ParseContext): JSONContent[] {
  const label = node.label || node.identifier;
  const markerNode: JSONContent = {
    type: 'text',
    text: `[^${label}]:`,
    marks: [
      {
        type: 'link',
        attrs: {
          href: `#fnref-${encodeURIComponent(node.identifier)}`,
          target: '_blank',
          title: null,
        },
      },
    ],
  };

  if (node.children.length === 1 && node.children[0].type === 'paragraph') {
    const restInline = mdastPhrasingToPM(
      node.children[0].children as ExtendedPhrasingContent[],
      ctx,
    );
    const content = mergeAdjacentTextNodes(
      restInline.length > 0
        ? [markerNode, { type: 'text', text: ' ' }, ...restInline]
        : [markerNode],
    );
    return [{ type: 'paragraph', content }];
  }

  const innerBlocks = (node.children as ExtendedRootContent[]).flatMap((child) =>
    mdastBlockToPM(child, ctx),
  );

  if (innerBlocks.length > 0 && innerBlocks[0].type === 'paragraph') {
    const existing = innerBlocks[0].content ?? [];
    innerBlocks[0] = {
      type: 'paragraph',
      content: mergeAdjacentTextNodes(
        existing.length > 0
          ? [markerNode, { type: 'text', text: ' ' }, ...existing]
          : [markerNode],
      ),
    };
  } else {
    innerBlocks.unshift({
      type: 'paragraph',
      content: [markerNode],
    });
  }

  return [
    {
      type: 'blockquote',
      content: innerBlocks,
    },
  ];
}

function mdastBlockToPM(node: ExtendedRootContent, ctx: ParseContext): JSONContent[] {
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
      const content = mdastPhrasingToPM(node.children as ExtendedPhrasingContent[], ctx);
      return [
        content.length > 0
          ? { type: 'heading', attrs: { level }, content }
          : { type: 'heading', attrs: { level } },
      ];
    }
    case 'paragraph': {
      const content = mdastPhrasingToPM(node.children as ExtendedPhrasingContent[], ctx);
      return [content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }];
    }
    case 'blockquote': {
      const alertNode = tryExtractGithubAlert(node, ctx);
      if (alertNode) return [alertNode];
      const content = (node.children as ExtendedRootContent[]).flatMap((c) => mdastBlockToPM(c, ctx));
      return [
        {
          type: 'blockquote',
          content: content.length > 0 ? content : [{ type: 'paragraph' }],
        },
      ];
    }
    case 'code': {
      const lang = (node.lang ?? '').trim();
      const meta = node.meta?.trim() ? node.meta.trim() : null;
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
          attrs: { language: lang, meta },
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
            content: node.children.map((li) => {
              const info = inspectListItemTaskState(li);
              if (info.isTask) {
                return {
                  type: 'taskItem',
                  attrs: { checked: info.checked },
                  content: mdastListItemToBlocks(li, ctx, info.strippedEmptyMarker),
                };
              }
              return {
                type: 'listItem',
                content: mdastListItemToBlocks(li, ctx),
              };
            }),
          },
        ];
      }

      const buckets: Array<{
        isTask: boolean;
        items: Array<{ li: ListItem; checked: boolean; strippedEmptyMarker: boolean }>;
      }> = [];

      for (const li of node.children) {
        const info = inspectListItemTaskState(li);
        const last = buckets[buckets.length - 1];
        if (!last || last.isTask !== info.isTask) {
          buckets.push({
            isTask: info.isTask,
            items: [{ li, checked: info.checked, strippedEmptyMarker: info.strippedEmptyMarker }],
          });
        } else {
          last.items.push({ li, checked: info.checked, strippedEmptyMarker: info.strippedEmptyMarker });
        }
      }

      return buckets.map((bucket) => {
        if (bucket.isTask) {
          return {
            type: 'taskList',
            content: bucket.items.map(({ li, checked, strippedEmptyMarker }) => ({
              type: 'taskItem',
              attrs: { checked },
              content: mdastListItemToBlocks(li, ctx, strippedEmptyMarker),
            })),
          };
        }
        return {
          type: 'bulletList',
          content: bucket.items.map(({ li }) => ({
            type: 'listItem',
            content: mdastListItemToBlocks(li, ctx),
          })),
        };
      });
    }
    case 'table': {
      return [mdastTableToPM(node, ctx)];
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
      const key = normalizeRefId(node.identifier);
      if (ctx.usedDefinitions.has(key)) {
        return [];
      }
      return [
        {
          type: 'rawHtmlBlock',
          attrs: { value: formatDefinitionLine(node) },
        },
      ];
    }
    case 'footnoteDefinition': {
      return mdastFootnoteDefinitionToPM(node, ctx);
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
  const ctx = prepareMdastTree(tree, markdown);
  const rawContent = (tree.children as ExtendedRootContent[]).flatMap((node) => mdastBlockToPM(node, ctx));

  // Ensure frontmatter only ever lives at index 0, followed by at least one block (`frontmatter? block+`)
  const content: JSONContent[] = [];
  for (let i = 0; i < rawContent.length; i += 1) {
    const block = rawContent[i];
    if (block.type === 'frontmatter' && content.length > 0) {
      content.push({
        type: 'codeBlock',
        attrs: { language: 'yaml', meta: null },
        content: block.attrs?.value ? [{ type: 'text', text: String(block.attrs.value) }] : [],
      });
    } else {
      content.push(block);
    }
  }

  if (content.length === 0) {
    content.push({ type: 'paragraph' });
  } else if (content.length === 1 && content[0].type === 'frontmatter') {
    content.push({ type: 'paragraph' });
  }

  return {
    type: 'doc',
    content,
  };
}

function marksEqual(a: MarkEntry, b: MarkEntry): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'link') {
    return (
      String(a.attrs?.href ?? '') === String(b.attrs?.href ?? '') &&
      (a.attrs?.title ?? null) === (b.attrs?.title ?? null)
    );
  }
  return true;
}

function hasMark(marks: MarkEntry[], target: MarkEntry): boolean {
  return marks.some((m) => marksEqual(m, target));
}

function wrapChildrenWithMark(children: ExtendedPhrasingContent[], mark: MarkEntry): ExtendedPhrasingContent {
  switch (mark.type) {
    case 'bold':
      return { type: 'strong', children: children as PhrasingContent[] };
    case 'italic':
      return { type: 'emphasis', children: children as PhrasingContent[] };
    case 'strike':
      return { type: 'delete', children: children as PhrasingContent[] };
    case 'link':
      return {
        type: 'link',
        url: String(mark.attrs?.href ?? ''),
        title: typeof mark.attrs?.title === 'string' && mark.attrs.title.length > 0 ? mark.attrs.title : undefined,
        children: children as PhrasingContent[],
      };
    default:
      return children[0];
  }
}

interface InlineAtomItem {
  leaf: ExtendedPhrasingContent;
  marks: MarkEntry[];
}

function groupInlineItems(items: InlineAtomItem[], start = 0, end = items.length): ExtendedPhrasingContent[] {
  const out: ExtendedPhrasingContent[] = [];
  let i = start;

  while (i < end) {
    const item = items[i];
    if (item.marks.length === 0) {
      out.push(item.leaf);
      i += 1;
      continue;
    }

    // Choose the mark on items[i] that spans the longest contiguous run [i .. bestEnd]
    let bestMark = item.marks[0];
    let bestEnd = i;

    for (const candidate of item.marks) {
      let runEnd = i;
      while (runEnd + 1 < end && hasMark(items[runEnd + 1].marks, candidate)) {
        runEnd += 1;
      }
      const bestPriority = MARK_PRIORITY[bestMark.type] ?? 99;
      const candPriority = MARK_PRIORITY[candidate.type] ?? 99;
      if (runEnd > bestEnd || (runEnd === bestEnd && candPriority < bestPriority)) {
        bestMark = candidate;
        bestEnd = runEnd;
      }
    }

    const innerItems: InlineAtomItem[] = [];
    for (let k = i; k <= bestEnd; k += 1) {
      innerItems.push({
        leaf: items[k].leaf,
        marks: items[k].marks.filter((m) => !marksEqual(m, bestMark)),
      });
    }

    const innerChildren = groupInlineItems(innerItems, 0, innerItems.length);
    out.push(wrapChildrenWithMark(innerChildren, bestMark));
    i = bestEnd + 1;
  }

  return mergeAdjacentMdastText(out);
}

function hoistEmphasisBoundaryWhitespace(nodes: ExtendedPhrasingContent[]): ExtendedPhrasingContent[] {
  const out: ExtendedPhrasingContent[] = [];

  for (const node of nodes) {
    if (node.type === 'link') {
      out.push({
        ...node,
        children: hoistEmphasisBoundaryWhitespace(node.children as ExtendedPhrasingContent[]) as PhrasingContent[],
      });
      continue;
    }

    if (node.type === 'strong' || node.type === 'emphasis' || node.type === 'delete') {
      const normalizedChildren = hoistEmphasisBoundaryWhitespace(
        node.children as ExtendedPhrasingContent[],
      );

      let leading = '';
      let trailing = '';

      if (normalizedChildren.length > 0 && normalizedChildren[0].type === 'text') {
        const m = normalizedChildren[0].value.match(/^[ \t]+/);
        if (m) {
          leading = m[0];
          const rest = normalizedChildren[0].value.slice(leading.length);
          if (rest.length > 0) {
            normalizedChildren[0] = { type: 'text', value: rest };
          } else {
            normalizedChildren.shift();
          }
        }
      }

      if (normalizedChildren.length > 0) {
        const lastIdx = normalizedChildren.length - 1;
        const lastChild = normalizedChildren[lastIdx];
        if (lastChild.type === 'text') {
          const m = lastChild.value.match(/[ \t]+$/);
          if (m) {
            trailing = m[0];
            const rest = lastChild.value.slice(0, lastChild.value.length - trailing.length);
            if (rest.length > 0) {
              normalizedChildren[lastIdx] = { type: 'text', value: rest };
            } else {
              normalizedChildren.pop();
            }
          }
        }
      }

      if (leading.length > 0) {
        out.push({ type: 'text', value: leading });
      }
      if (normalizedChildren.length > 0) {
        out.push({
          ...node,
          children: normalizedChildren as PhrasingContent[],
        });
      }
      if (trailing.length > 0) {
        out.push({ type: 'text', value: trailing });
      }
      continue;
    }

    out.push(node);
  }

  return mergeAdjacentMdastText(out);
}

function filterSupportedOuterMarks(rawMarks: MarkEntry[] | undefined): MarkEntry[] {
  if (!rawMarks || rawMarks.length === 0) return [];
  const filtered: MarkEntry[] = [];
  for (const m of rawMarks) {
    if (SUPPORTED_OUTER_MARKS.has(m.type) && !hasMark(filtered, m)) {
      filtered.push(m);
    }
  }
  return filtered;
}

function pmInlineToMdast(nodes: JSONContent[] | undefined): ExtendedPhrasingContent[] {
  if (!nodes || nodes.length === 0) return [];
  const items: InlineAtomItem[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case 'text': {
        const text = node.text ?? '';
        if (!text) break;
        const rawMarks = (node.marks ?? []) as MarkEntry[];

        // Check for footnote reference link `#fn-<id>` with `[^label]` text
        const fnLinkMark = rawMarks.find(
          (m) => m.type === 'link' && typeof m.attrs?.href === 'string' && m.attrs.href.startsWith('#fn-'),
        );
        const fnMatch = fnLinkMark ? text.match(FOOTNOTE_REF_TEXT_RE) : null;
        if (fnLinkMark && fnMatch) {
          const rawId = String(fnLinkMark.attrs?.href ?? '').slice('#fn-'.length);
          let identifier = fnMatch[1];
          try {
            identifier = decodeURIComponent(rawId) || fnMatch[1];
          } catch {
            identifier = fnMatch[1];
          }
          const otherMarks = filterSupportedOuterMarks(rawMarks.filter((m) => m !== fnLinkMark));
          items.push({
            leaf: {
              type: 'footnoteReference',
              identifier,
              label: fnMatch[1],
            },
            marks: otherMarks,
          });
          break;
        }

        const hasCode = rawMarks.some((m) => m.type === 'code');
        const outerMarks = filterSupportedOuterMarks(rawMarks);

        // Merge adjacent `inlineCode` text fragments that share identical outer marks
        const prev = items[items.length - 1];
        if (
          hasCode &&
          prev &&
          prev.leaf.type === 'inlineCode' &&
          prev.marks.length === outerMarks.length &&
          prev.marks.every((m, idx) => marksEqual(m, outerMarks[idx]))
        ) {
          prev.leaf = { type: 'inlineCode', value: prev.leaf.value + text };
          break;
        }

        items.push({
          leaf: hasCode ? { type: 'inlineCode', value: text } : { type: 'text', value: text },
          marks: outerMarks,
        });
        break;
      }
      case 'hardBreak': {
        items.push({
          leaf: { type: 'break' },
          marks: filterSupportedOuterMarks(node.marks as MarkEntry[] | undefined),
        });
        break;
      }
      case 'image': {
        items.push({
          leaf: {
            type: 'image',
            url: String(node.attrs?.src ?? ''),
            alt: typeof node.attrs?.alt === 'string' ? node.attrs.alt : '',
            title:
              typeof node.attrs?.title === 'string' && node.attrs.title.length > 0
                ? node.attrs.title
                : undefined,
          },
          marks: filterSupportedOuterMarks(node.marks as MarkEntry[] | undefined),
        });
        break;
      }
      case 'mathInline': {
        const latex = String(node.attrs?.latex ?? '');
        if (latex.trim().length === 0) break;
        items.push({
          leaf: {
            type: 'inlineMath',
            value: latex,
          },
          marks: filterSupportedOuterMarks(node.marks as MarkEntry[] | undefined),
        });
        break;
      }
      case 'rawHtmlInline': {
        const val = String(node.attrs?.value ?? '');
        if (!val) break;
        items.push({
          leaf: {
            type: 'html',
            value: val,
          },
          marks: filterSupportedOuterMarks(node.marks as MarkEntry[] | undefined),
        });
        break;
      }
      default:
        break;
    }
  }

  if (items.length === 0) return [];
  const grouped = groupInlineItems(items);
  return hoistEmphasisBoundaryWhitespace(grouped);
}

function pmListToMdast(node: JSONContent, ordered: boolean, taskList: boolean): List {
  const items: ListItem[] = (node.content ?? []).map((item) => {
    const childBlocks = (item.content ?? []).flatMap((block) => pmBlockToMdast(block));
    const isTask = taskList || item.type === 'taskItem' || typeof item.attrs?.checked === 'boolean';
    return {
      type: 'listItem',
      spread: false,
      checked: isTask ? Boolean(item.attrs?.checked) : null,
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

function escapeTableMathPipes(latex: string): string {
  if (!latex.includes('|')) return latex;
  let out = '';
  for (let i = 0; i < latex.length; i += 1) {
    if (latex[i] === '|') {
      let backslashes = 0;
      for (let j = i - 1; j >= 0 && latex[j] === '\\'; j -= 1) {
        backslashes += 1;
      }
      if (backslashes % 2 === 0) {
        const nextChar = latex[i + 1] ?? '';
        out += /^[a-zA-Z]/.test(nextChar) ? '\\vert ' : '\\vert';
        continue;
      }
    }
    out += latex[i];
  }
  return out;
}

function sanitizeCellPhrasingForGfm(nodes: ExtendedPhrasingContent[]): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  for (const node of nodes) {
    if (node.type === 'break') {
      out.push({ type: 'html', value: '<br>' });
    } else if (node.type === 'inlineMath') {
      out.push({
        type: 'inlineMath',
        value: escapeTableMathPipes(node.value.replace(/\r?\n/g, ' ')),
      } as unknown as PhrasingContent);
    } else if (
      node.type === 'strong' ||
      node.type === 'emphasis' ||
      node.type === 'delete' ||
      node.type === 'link'
    ) {
      out.push({
        ...node,
        children: sanitizeCellPhrasingForGfm(node.children as ExtendedPhrasingContent[]),
      });
    } else {
      out.push(node as PhrasingContent);
    }
  }
  return out;
}

function serializeTableCellBlock(block: JSONContent): PhrasingContent[] {
  switch (block.type) {
    case 'paragraph':
    case 'heading': {
      return sanitizeCellPhrasingForGfm(pmInlineToMdast(block.content));
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const parts: PhrasingContent[] = [];
      const start = Number(block.attrs?.start ?? 1);
      (block.content ?? []).forEach((li, idx) => {
        if (parts.length > 0) {
          parts.push({ type: 'html', value: '<br>' });
        }
        const isTask =
          block.type === 'taskList' || li.type === 'taskItem' || typeof li.attrs?.checked === 'boolean';
        const prefix =
          block.type === 'orderedList'
            ? `${start + idx}. ${isTask ? (li.attrs?.checked ? '☑ ' : '☐ ') : ''}`
            : isTask
              ? li.attrs?.checked
                ? '☑ '
                : '☐ '
              : '• ';
        parts.push({ type: 'text', value: prefix });
        const itemParts = (li.content ?? [])
          .map((child) => serializeTableCellBlock(child))
          .filter((seg) => seg.length > 0);
        itemParts.forEach((seg, segIdx) => {
          if (segIdx > 0) parts.push({ type: 'html', value: '<br>' });
          parts.push(...seg);
        });
      });
      return parts;
    }
    case 'codeBlock': {
      const code = (block.content ?? []).map((c) => c.text ?? '').join('');
      if (!code) return [];
      const lines = code.split(/\r?\n/);
      const parts: PhrasingContent[] = [];
      lines.forEach((line, idx) => {
        if (idx > 0) parts.push({ type: 'html', value: '<br>' });
        if (line.length > 0) parts.push({ type: 'inlineCode', value: line });
      });
      return parts;
    }
    case 'mermaidBlock': {
      const code = String(block.attrs?.code ?? '').trim();
      if (!code) return [];
      return [{ type: 'inlineCode', value: code.replace(/\r?\n/g, '; ') }];
    }
    case 'mathBlock': {
      const latex = String(block.attrs?.latex ?? '').replace(/\r?\n/g, ' ').trim();
      if (!latex) return [];
      return [
        {
          type: 'inlineMath',
          value: escapeTableMathPipes(latex),
        } as unknown as PhrasingContent,
      ];
    }
    case 'blockquote':
    case 'githubAlert': {
      const parts: PhrasingContent[] = [];
      if (block.type === 'githubAlert') {
        const kind = normalizeAlertKind(String(block.attrs?.alertType ?? 'NOTE'));
        parts.push({ type: 'strong', children: [{ type: 'text', value: `${kind}: ` }] });
      }
      const sub = (block.content ?? [])
        .map((child) => serializeTableCellBlock(child))
        .filter((seg) => seg.length > 0);
      sub.forEach((seg, idx) => {
        if (idx > 0) parts.push({ type: 'html', value: '<br>' });
        parts.push(...seg);
      });
      return parts;
    }
    case 'horizontalRule':
      return [{ type: 'html', value: '<hr>' }];
    case 'rawHtmlBlock': {
      const val = String(block.attrs?.value ?? '').replace(/\r?\n/g, ' ').trim();
      return val ? [{ type: 'html', value: val }] : [];
    }
    default:
      return sanitizeCellPhrasingForGfm(pmInlineToMdast(block.content));
  }
}

function isExplicitAlign(val: unknown): val is 'left' | 'center' | 'right' {
  return val === 'left' || val === 'center' || val === 'right';
}

function resolveColumnAlignment(colCells: Array<AlignType | undefined>): AlignType {
  const explicit = colCells.filter(isExplicitAlign);
  if (explicit.length === 0) return null;

  const unique = Array.from(new Set(explicit));
  if (unique.length === 1) return unique[0];

  // When a single cell in a 3+ row column was updated (header or body), pick the minority outlier edit
  if (explicit.length >= 3) {
    const counts = new Map<'left' | 'center' | 'right', number>();
    for (const a of explicit) counts.set(a, (counts.get(a) ?? 0) + 1);
    for (const [alignVal, count] of counts.entries()) {
      if (count === 1) return alignVal;
    }
  }

  // In a 2-row table where header kept initial alignment and body row was changed, prefer the body edit
  for (let r = 1; r < colCells.length; r += 1) {
    const bodyAlign = colCells[r];
    if (isExplicitAlign(bodyAlign) && bodyAlign !== colCells[0]) {
      return bodyAlign;
    }
  }

  return explicit[0];
}

function pmTableToMdast(node: JSONContent): Table {
  const pmRows = node.content ?? [];
  const colCount = pmRows.reduce((max, row) => Math.max(max, row.content?.length ?? 0), 0);
  const colAlignSamples: Array<Array<AlignType | undefined>> = Array.from(
    { length: colCount },
    () => [],
  );

  const mdRows: TableRow[] = pmRows.map((row) => {
    const cells: TableCell[] = (row.content ?? []).map((cell, colIndex) => {
      colAlignSamples[colIndex]?.push(cell.attrs?.textAlign as AlignType | undefined);

      const blocks = cell.content ?? [];
      const inlineChildren: PhrasingContent[] = [];

      blocks.forEach((block, blockIndex) => {
        const blockInline = serializeTableCellBlock(block);
        if (blockIndex > 0 && (inlineChildren.length > 0 || blockInline.length > 0)) {
          inlineChildren.push({ type: 'html', value: '<br>' });
        }
        inlineChildren.push(...blockInline);
      });

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

  const align: AlignType[] = colAlignSamples.map((samples) => resolveColumnAlignment(samples));

  return {
    type: 'table',
    align,
    children: mdRows,
  };
}

function tryExtractFootnoteDefMarker(
  paraNode: JSONContent | undefined,
): { identifier: string; label: string; restInline: JSONContent[] } | null {
  if (!paraNode || paraNode.type !== 'paragraph' || !paraNode.content || paraNode.content.length === 0) {
    return null;
  }
  const first = paraNode.content[0];
  if (first.type !== 'text' || typeof first.text !== 'string') return null;

  const marks = (first.marks ?? []) as MarkEntry[];
  const fnRefBack = marks.find(
    (m) => m.type === 'link' && typeof m.attrs?.href === 'string' && m.attrs.href.startsWith('#fnref-'),
  );
  if (!fnRefBack) return null;

  const m = first.text.match(FOOTNOTE_DEF_MARKER_RE);
  if (!m) return null;

  const rawId = String(fnRefBack.attrs?.href ?? '').slice('#fnref-'.length);
  let identifier = m[1];
  try {
    identifier = decodeURIComponent(rawId) || m[1];
  } catch {
    identifier = m[1];
  }

  const restInline = paraNode.content.slice(1).map((n) => ({ ...n }));
  if (restInline.length > 0 && restInline[0].type === 'text' && typeof restInline[0].text === 'string') {
    if (restInline[0].text === ' ') {
      restInline.shift();
    } else if (restInline[0].text.startsWith(' ')) {
      restInline[0] = { ...restInline[0], text: restInline[0].text.slice(1) };
    }
  }

  return { identifier, label: m[1], restInline };
}

function pmBlockToMdast(node: JSONContent): ExtendedRootContent[] {
  switch (node.type) {
    case 'frontmatter': {
      const raw = String(node.attrs?.value ?? '').replace(/^\r?\n+|\r?\n+$/g, '');
      return [{ type: 'yaml', value: raw }];
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
      const fnDef = tryExtractFootnoteDefMarker(node);
      if (fnDef) {
        return [
          {
            type: 'footnoteDefinition',
            identifier: fnDef.identifier,
            label: fnDef.label,
            children: [
              {
                type: 'paragraph',
                children: pmInlineToMdast(fnDef.restInline) as PhrasingContent[],
              },
            ],
          },
        ];
      }
      return [
        {
          type: 'paragraph',
          children: pmInlineToMdast(node.content) as PhrasingContent[],
        },
      ];
    }
    case 'blockquote': {
      const blockChildren = node.content ?? [];
      const fnDef = tryExtractFootnoteDefMarker(blockChildren[0]);
      if (fnDef) {
        const restBlocks = blockChildren.slice(1).flatMap((c) => pmBlockToMdast(c));
        const firstParaInline = pmInlineToMdast(fnDef.restInline) as PhrasingContent[];
        const fnChildren: Array<BlockContent | DefinitionContent> = [];
        if (firstParaInline.length > 0 || restBlocks.length === 0) {
          fnChildren.push({ type: 'paragraph', children: firstParaInline });
        }
        fnChildren.push(...(restBlocks as Array<BlockContent | DefinitionContent>));
        return [
          {
            type: 'footnoteDefinition',
            identifier: fnDef.identifier,
            label: fnDef.label,
            children: fnChildren,
          },
        ];
      }

      const children = blockChildren.flatMap((c) => pmBlockToMdast(c));
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
        const markerNode: Html = {
          type: 'html',
          value: firstPara.children.length > 0 ? `[!${alertType}]\n` : `[!${alertType}]`,
        };
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
      const rawLang = typeof node.attrs?.language === 'string' ? node.attrs.language.trim() : '';
      const lang = rawLang.length > 0 ? rawLang : null;
      const rawMeta = typeof node.attrs?.meta === 'string' ? node.attrs.meta.trim() : '';
      const meta = lang && rawMeta.length > 0 ? rawMeta : null;
      const value = (node.content ?? []).map((c) => c.text ?? '').join('');
      const codeNode: Code = {
        type: 'code',
        lang,
        meta,
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
  const rawChildren = (doc.content ?? []).flatMap((node) => pmBlockToMdast(node));

  // Keep YAML frontmatter strictly at index 0 so it never serializes as `<hr>` + Setext heading
  const yamlNodes: YamlMdast[] = [];
  const otherNodes: ExtendedRootContent[] = [];
  for (const child of rawChildren) {
    if (child.type === 'yaml' && yamlNodes.length === 0) {
      yamlNodes.push(child);
    } else if (child.type === 'yaml') {
      otherNodes.push({
        type: 'code',
        lang: 'yaml',
        meta: null,
        value: child.value,
      });
    } else {
      otherNodes.push(child);
    }
  }

  const root: Root = {
    type: 'root',
    children: [...yamlNodes, ...otherNodes] as RootContent[],
  };
  const out = stringifier.stringify(root);
  return out.replace(/\n{3,}/g, '\n\n').trimEnd() + (out.length > 0 ? '\n' : '');
}

function extractHeadingText(heading: Heading): string {
  const parts: string[] = [];
  const walk = (nodes: ExtendedPhrasingContent[]) => {
    for (const n of nodes) {
      if (n.type === 'footnoteReference') {
        const fn = n as FootnoteReference;
        parts.push(`[^${fn.label || fn.identifier}]`);
      } else if (
        n.type === 'strong' ||
        n.type === 'emphasis' ||
        n.type === 'delete' ||
        n.type === 'link' ||
        n.type === 'linkReference'
      ) {
        walk(n.children as ExtendedPhrasingContent[]);
      } else {
        const s = mdastToString(n as never);
        if (s) parts.push(s);
      }
    }
  };
  walk(heading.children as ExtendedPhrasingContent[]);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

export function extractHeadingsOutline(markdown: string): OutlineHeading[] {
  if (!markdown || markdown.trim().length === 0 || !/[#=-]/.test(markdown)) return [];

  // Replace huge single-line Base64 payloads before parsing while keeping exact 1-based line numbers
  const lightweightMd = markdown.includes('data:image/')
    ? markdown.replace(DATA_URI_FAST_OUTLINE_RE, 'data:image/png;base64,AA==')
    : markdown;

  const tree = parser.parse(lightweightMd) as Root;
  const headings: OutlineHeading[] = [];
  let index = 0;

  const visitBlocks = (nodes: ExtendedRootContent[]) => {
    for (const node of nodes) {
      if (node.type === 'heading') {
        const text = extractHeadingText(node);
        if (text.length > 0) {
          headings.push({
            id: `heading-${index++}`,
            level: Math.min(6, Math.max(1, node.depth || 1)),
            text,
            line: node.position?.start.line ?? 1,
          });
        }
      } else if (node.type === 'blockquote' || node.type === 'footnoteDefinition') {
        visitBlocks(node.children as ExtendedRootContent[]);
      } else if (node.type === 'list') {
        for (const li of node.children) {
          visitBlocks(li.children as ExtendedRootContent[]);
        }
      }
    }
  };

  visitBlocks(tree.children as ExtendedRootContent[]);
  return headings;
}

export function computeDocumentStats(markdown: string): {
  words: number;
  chars: number;
  readingMinutes: number;
} {
  if (!markdown) {
    return { words: 0, chars: 0, readingMinutes: 0 };
  }

  const withoutDataUris = markdown.includes('data:image/')
    ? markdown.replace(DATA_URI_STRIP_RE, '')
    : markdown;

  const chars = withoutDataUris.length;

  const cleanText = withoutDataUris
    .replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, ' ')
    .replace(/```[^\r\n]*\r?\n([\s\S]*?)```/g, ' $1 ')
    .replace(/`([^`]*)`/g, ' $1 ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, ' $1 ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/gm, ' ')
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, ' ')
    .replace(/[|>~*_`]+/g, ' ')
    .trim();

  const tokens = cleanText.length === 0 ? [] : cleanText.split(/\s+/).filter((tok) => /[\p{L}\p{N}]/u.test(tok));
  const words = tokens.length;
  const readingMinutes = words === 0 ? 0 : Math.max(1, Math.ceil(words / 200));
  return { words, chars, readingMinutes };
}
