import type { JSONContent } from '@tiptap/core';
import { markdownToProseMirrorDoc } from '../markdown/bridge';
import { renderLatexHtml } from '../renderers/katexRenderer';
import { renderMermaidSvg, type ThemeMode } from '../renderers/mermaidRenderer';
import { isSafeExportUrl, sanitizeMarkdownHtml } from './htmlSanitizer';

export interface ExportHtmlOptions {
  locale?: string;
  defaultDocFilename?: string;
}

const ALLOWED_ALERT_KINDS = new Set(['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']);
const ALLOWED_TEXT_ALIGNS = new Set(['left', 'center', 'right', 'justify']);

const EXPORT_CSP_CONTENT =
  "default-src 'none'; img-src data: https: http: blob:; style-src 'unsafe-inline'; font-src data:;";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function applyInlineMarks(initialHtml: string, marks: JSONContent['marks']): string {
  if (!marks || marks.length === 0) return initialHtml;
  let html = initialHtml;

  for (const mark of marks) {
    switch (mark.type) {
      case 'code':
        html = `<code>${html}</code>`;
        break;
      case 'bold':
        html = `<strong>${html}</strong>`;
        break;
      case 'italic':
        html = `<em>${html}</em>`;
        break;
      case 'strike':
        html = `<del>${html}</del>`;
        break;
      case 'link': {
        const rawHref = String(mark.attrs?.href ?? '');
        const safeHref = isSafeExportUrl(rawHref, false) ? rawHref.trim() : '#';
        const href = escapeHtml(safeHref);
        const title = mark.attrs?.title ? ` title="${escapeHtml(String(mark.attrs.title))}"` : '';
        html = `<a href="${href}"${title} target="_blank" rel="noopener noreferrer">${html}</a>`;
        break;
      }
      default:
        break;
    }
  }

  return html;
}

function createUniqueSlotPrefix(nodes: JSONContent[]): string {
  const combined = nodes
    .map((n) => `${n.text ?? ''}${String(n.attrs?.value ?? '')}`)
    .join('');
  let prefix = 'pmd-trusted-slot-';
  let salt = 1;
  while (combined.includes(prefix)) {
    prefix = `pmd-trusted-slot-${salt++}-`;
  }
  return prefix;
}

async function renderInlineNodes(nodes: JSONContent[] | undefined): Promise<string> {
  if (!nodes || nodes.length === 0) return '';
  const hasRawInline = nodes.some((n) => n.type === 'rawHtmlInline');
  const slotPrefix = hasRawInline ? createUniqueSlotPrefix(nodes) : '';
  const trustedSlots: string[] = [];
  const parts: string[] = [];

  for (const node of nodes) {
    if (node.type === 'text') {
      const html = applyInlineMarks(escapeHtml(node.text ?? ''), node.marks);
      parts.push(html);
    } else if (node.type === 'hardBreak') {
      parts.push('<br />');
    } else if (node.type === 'image') {
      const rawSrc = String(node.attrs?.src ?? '');
      const alt = escapeHtml(String(node.attrs?.alt ?? ''));
      const title = node.attrs?.title ? ` title="${escapeHtml(String(node.attrs.title))}"` : '';
      const imgHtml = isSafeExportUrl(rawSrc, true)
        ? `<img src="${escapeHtml(rawSrc.trim())}" alt="${alt}"${title} style="max-width:100%;height:auto;border-radius:6px;" />`
        : `<img alt="${alt}"${title} style="max-width:100%;height:auto;border-radius:6px;" />`;
      parts.push(applyInlineMarks(imgHtml, node.marks));
    } else if (node.type === 'mathInline') {
      const latex = String(node.attrs?.latex ?? '');
      const rendered = await renderLatexHtml(latex, false);
      const mathHtml = `<span class="math-inline">${rendered.html || `<code>$${escapeHtml(latex)}$</code>`}</span>`;
      if (hasRawInline) {
        const slotIdx = trustedSlots.length;
        trustedSlots.push(mathHtml);
        parts.push(applyInlineMarks(`<span class="${slotPrefix}${slotIdx}"></span>`, node.marks));
      } else {
        parts.push(applyInlineMarks(mathHtml, node.marks));
      }
    } else if (node.type === 'rawHtmlInline') {
      parts.push(String(node.attrs?.value ?? ''));
    }
  }

  const joined = parts.join('');
  if (!hasRawInline) {
    return joined;
  }

  let sanitized = sanitizeMarkdownHtml(joined);
  for (let i = 0; i < trustedSlots.length; i++) {
    const marker = `<span class="${slotPrefix}${i}"></span>`;
    sanitized = sanitized.split(marker).join(trustedSlots[i]);
  }
  return sanitized;
}

async function renderBlockNodes(nodes: JSONContent[] | undefined, theme: ThemeMode): Promise<string> {
  if (!nodes || nodes.length === 0) return '';
  const out: string[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case 'frontmatter': {
        const val = String(node.attrs?.value ?? '');
        out.push(`<pre class="frontmatter"><code>${escapeHtml(val)}</code></pre>`);
        break;
      }
      case 'heading': {
        const lvl = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)));
        const inner = await renderInlineNodes(node.content);
        out.push(`<h${lvl}>${inner}</h${lvl}>`);
        break;
      }
      case 'paragraph': {
        const inner = await renderInlineNodes(node.content);
        out.push(`<p>${inner}</p>`);
        break;
      }
      case 'blockquote': {
        const inner = await renderBlockNodes(node.content, theme);
        out.push(`<blockquote>${inner}</blockquote>`);
        break;
      }
      case 'githubAlert': {
        const rawKind = String(node.attrs?.alertType ?? 'NOTE').toUpperCase();
        const kind = ALLOWED_ALERT_KINDS.has(rawKind) ? rawKind : 'NOTE';
        const inner = await renderBlockNodes(node.content, theme);
        out.push(
          `<div class="github-alert alert-${kind.toLowerCase()}"><div class="alert-title">${escapeHtml(kind)}</div>${inner}</div>`,
        );
        break;
      }
      case 'codeBlock': {
        const lang = escapeHtml(String(node.attrs?.language ?? ''));
        const code = escapeHtml((node.content ?? []).map((c) => c.text ?? '').join(''));
        out.push(`<pre><code class="language-${lang}">${code}</code></pre>`);
        break;
      }
      case 'mermaidBlock': {
        const code = String(node.attrs?.code ?? '');
        const rendered = await renderMermaidSvg(code, theme);
        if (rendered.svg) {
          out.push(`<div class="mermaid-export">${rendered.svg}</div>`);
        } else {
          out.push(`<pre><code>${escapeHtml(code)}</code></pre>`);
        }
        break;
      }
      case 'mathBlock': {
        const latex = String(node.attrs?.latex ?? '');
        const rendered = await renderLatexHtml(latex, true);
        out.push(`<div class="math-block">${rendered.html || `<pre>$$${escapeHtml(latex)}$$</pre>`}</div>`);
        break;
      }
      case 'bulletList': {
        const items = await Promise.all(
          (node.content ?? []).map(async (li) => `<li>${await renderBlockNodes(li.content, theme)}</li>`),
        );
        out.push(`<ul>${items.join('')}</ul>`);
        break;
      }
      case 'orderedList': {
        const parsedStart = Number(node.attrs?.start ?? 1);
        const start = Number.isFinite(parsedStart) ? Math.max(1, Math.trunc(parsedStart)) : 1;
        const items = await Promise.all(
          (node.content ?? []).map(async (li) => `<li>${await renderBlockNodes(li.content, theme)}</li>`),
        );
        out.push(`<ol start="${start}">${items.join('')}</ol>`);
        break;
      }
      case 'taskList': {
        const items = await Promise.all(
          (node.content ?? []).map(async (li) => {
            const checked = Boolean(li.attrs?.checked);
            const inner = await renderBlockNodes(li.content, theme);
            return `<li class="task-item"><input type="checkbox" ${checked ? 'checked' : ''} disabled /> <div>${inner}</div></li>`;
          }),
        );
        out.push(`<ul class="task-list">${items.join('')}</ul>`);
        break;
      }
      case 'table': {
        const rowsHtml: string[] = [];
        for (const row of node.content ?? []) {
          const cellsHtml: string[] = [];
          for (const cell of row.content ?? []) {
            const tag = cell.type === 'tableHeader' ? 'th' : 'td';
            const rawAlign = String(cell.attrs?.textAlign ?? '').trim().toLowerCase();
            const align = ALLOWED_TEXT_ALIGNS.has(rawAlign) ? ` style="text-align:${rawAlign}"` : '';
            const inner = await renderBlockNodes(cell.content, theme);
            cellsHtml.push(`<${tag}${align}>${inner}</${tag}>`);
          }
          rowsHtml.push(`<tr>${cellsHtml.join('')}</tr>`);
        }
        out.push(`<table>${rowsHtml.join('')}</table>`);
        break;
      }
      case 'horizontalRule':
        out.push('<hr />');
        break;
      case 'rawHtmlBlock': {
        const sanitized = sanitizeMarkdownHtml(String(node.attrs?.value ?? ''));
        if (sanitized) {
          out.push(sanitized);
        }
        break;
      }
      default:
        break;
    }
  }

  return out.join('\n');
}

export async function renderMarkdownToStaticHtmlBody(markdown: string, theme: ThemeMode): Promise<string> {
  const doc = markdownToProseMirrorDoc(markdown);
  return await renderBlockNodes(doc.content, theme);
}

export function stripKatexMathml(html: string): string {
  if (!html.includes('katex-mathml')) return html;
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(
      `<!DOCTYPE html><html><body>${html}</body></html>`,
      'text/html',
    );
    doc.body.querySelectorAll('.katex-mathml').forEach((el) => el.remove());
    return doc.body.innerHTML;
  }
  return html.replace(/<span\s+class="katex-mathml"[^>]*>[\s\S]*?<\/math><\/span>/gi, '');
}

export function resolveCssUrls(css: string, baseHref: string): string {
  if (!baseHref) return css;
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote: string, rawUrl: string) => {
    const trimmed = rawUrl.trim();
    if (
      !trimmed ||
      trimmed.startsWith('data:') ||
      trimmed.startsWith('blob:') ||
      trimmed.startsWith('#') ||
      /^https?:\/\//i.test(trimmed)
    ) {
      return match;
    }
    try {
      const resolved = new URL(trimmed, baseHref).href;
      return `url(${quote || '"'}${resolved}${quote || '"'})`;
    } catch {
      return match;
    }
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

const fontDataUriCache = new Map<string, string>();

async function fetchFontAsDataUri(url: string, mime: string): Promise<string | null> {
  const cached = fontDataUriCache.get(url);
  if (cached) return cached;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const dataUri = `data:${mime};base64,${arrayBufferToBase64(buffer)}`;
    fontDataUriCache.set(url, dataUri);
    return dataUri;
  } catch {
    return null;
  }
}

async function inlineFontFaceBlocks(css: string, baseHref: string): Promise<string> {
  const resolvedCss = resolveCssUrls(css, baseHref).replace(/font-display\s*:\s*block/gi, 'font-display: swap');
  const fontFaceRegex = /@font-face\s*\{[^}]*\}/gi;
  const matches = Array.from(resolvedCss.matchAll(fontFaceRegex));
  if (matches.length === 0) return resolvedCss;

  const replacements = await Promise.all(
    matches.map(async (m) => {
      const block = m[0];
      const woff2Match = block.match(/url\(\s*(['"]?)([^'")\s]+\.woff2(?:\?[^'")\s]*)?)\1\s*\)/i);
      const fallbackMatch =
        woff2Match ?? block.match(/url\(\s*(['"]?)([^'")\s]+)\1\s*\)/i);
      if (!fallbackMatch) return block;

      const rawUrl = fallbackMatch[2].trim();
      if (!rawUrl || rawUrl.startsWith('data:')) return block;

      const isWoff2 = Boolean(woff2Match);
      const mime = isWoff2
        ? 'font/woff2'
        : rawUrl.toLowerCase().includes('.woff')
          ? 'font/woff'
          : 'font/ttf';
      const dataUri = await fetchFontAsDataUri(rawUrl, mime);
      if (!dataUri) return block;

      if (isWoff2) {
        return block.replace(/src\s*:[^;]+;/i, `src: url("${dataUri}") format("woff2");`);
      }
      return block.replace(fallbackMatch[0], `url("${dataUri}")`);
    }),
  );

  let out = '';
  let lastIndex = 0;
  matches.forEach((m, idx) => {
    const start = m.index ?? 0;
    out += resolvedCss.slice(lastIndex, start) + replacements[idx];
    lastIndex = start + m[0].length;
  });
  out += resolvedCss.slice(lastIndex);
  return out;
}

async function collectKatexStyles(): Promise<string> {
  if (typeof document === 'undefined') return '';
  const fallbackBase = typeof window !== 'undefined' ? window.location.href : '';
  const sheetTasks: Array<Promise<string>> = [];

  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = Array.from(sheet.cssRules ?? []);
      const css = rules.map((r) => r.cssText).join('\n');
      if (css.includes('.katex')) {
        const baseHref = sheet.href || fallbackBase;
        sheetTasks.push(inlineFontFaceBlocks(css, baseHref));
      }
    } catch {
      // Cross-origin stylesheet skipped safely
    }
  }

  const parts = await Promise.all(sheetTasks);
  return parts.join('\n');
}

export function buildStandaloneHtmlDocument(
  title: string,
  bodyHtml: string,
  theme: ThemeMode,
  katexCss = '',
  options?: ExportHtmlOptions,
): string {
  const isDark = theme === 'dark';
  const isSepia = theme === 'sepia';
  const bg = isDark ? '#0f141b' : isSepia ? '#f7f1e3' : '#ffffff';
  const fg = isDark ? '#e6edf3' : isSepia ? '#3b2f24' : '#1f2328';
  const border = isDark ? '#30363d' : isSepia ? '#dccbb0' : '#d0d7de';
  const codeBg = isDark ? '#161b22' : isSepia ? '#efe6d5' : '#f6f8fa';

  const rawLocale = options?.locale?.trim() || 'es';
  const safeLang = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(rawLocale) ? rawLocale : 'es';
  const defaultFilename = options?.defaultDocFilename?.trim() || 'documento';
  const effectiveTitle = title.trim() || defaultFilename;
  const safeKatexCss = katexCss.replace(/<\/style/gi, '<\\/style');

  return `<!DOCTYPE html>
<html lang="${escapeHtml(safeLang)}">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${EXPORT_CSP_CONTENT}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(effectiveTitle)}</title>
<style>
  :root { color-scheme: ${isDark ? 'dark' : 'light'}; }
  body {
    margin: 0;
    padding: 40px 24px;
    background: ${bg};
    color: ${fg};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    line-height: 1.7;
  }
  main { max-width: 860px; margin: 0 auto; }
  h1, h2, h3, h4 { line-height: 1.3; margin-top: 1.5em; }
  h1, h2 { border-bottom: 1px solid ${border}; padding-bottom: 0.25em; }
  pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  code { background: ${codeBg}; padding: 0.15em 0.35em; border-radius: 4px; font-size: 0.9em; }
  pre { background: ${codeBg}; padding: 14px 16px; border-radius: 8px; overflow-x: auto; border: 1px solid ${border}; }
  pre code { background: transparent; padding: 0; }
  blockquote { border-left: 4px solid ${border}; margin: 1em 0; padding: 0.2em 1em; opacity: 0.9; }
  table { border-collapse: collapse; width: 100%; margin: 1.2em 0; }
  th, td { border: 1px solid ${border}; padding: 8px 12px; }
  th { background: ${codeBg}; font-weight: 600; }
  th p, td p { margin: 0; }
  ul.task-list { list-style: none; padding-left: 4px; }
  li.task-item { display: flex; align-items: flex-start; gap: 8px; margin: 4px 0; }
  li.task-item p { margin: 0; }
  .github-alert { border-left: 4px solid #3b82f6; background: ${codeBg}; padding: 12px 16px; border-radius: 6px; margin: 1em 0; }
  .github-alert .alert-title { font-weight: 700; font-size: 0.85em; letter-spacing: 0.04em; margin-bottom: 4px; }
  .alert-tip { border-left-color: #10b981; }
  .alert-important { border-left-color: #8b5cf6; }
  .alert-warning { border-left-color: #f59e0b; }
  .alert-caution { border-left-color: #ef4444; }
  .mermaid-export { margin: 1.2em 0; text-align: center; }
  .mermaid-export svg { max-width: 100%; height: auto; }
  .math-block { margin: 1.2em 0; text-align: center; overflow-x: auto; }
  @media print {
    body { background: #fff !important; color: #111 !important; padding: 0; }
    h1, h2, td, blockquote { border-color: #d0d7de !important; }
    pre, code, th, .github-alert { background: #f6f8fa !important; color: #111 !important; border-color: #d0d7de !important; }
    pre code { background: transparent !important; }
    .alert-tip { border-left-color: #10b981 !important; }
    .alert-important { border-left-color: #8b5cf6 !important; }
    .alert-warning { border-left-color: #f59e0b !important; }
    .alert-caution { border-left-color: #ef4444 !important; }
    pre, table, .mermaid-export, .github-alert, .math-block { break-inside: avoid; }
    .mermaid-export svg { max-width: 100%; height: auto; }
    .math-block { overflow: visible; }
  }
  ${safeKatexCss}
</style>
</head>
<body>
<main>${bodyHtml}</main>
</body>
</html>`;
}

export async function exportStandaloneHtml(
  title: string,
  markdown: string,
  theme: ThemeMode,
  options?: ExportHtmlOptions,
): Promise<void> {
  const body = await renderMarkdownToStaticHtmlBody(markdown, theme);
  const katexCss = body.includes('class="katex"') ? await collectKatexStyles() : '';
  const fullHtml = buildStandaloneHtmlDocument(title, body, theme, katexCss, options);
  const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const defaultFilename = options?.defaultDocFilename?.trim() || 'documento';
  const cleanName = title.replace(/\.(md|markdown|mdx|mdown)$/i, '').trim() || defaultFilename;
  a.href = url;
  a.download = `${cleanName}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function waitForPrintDocumentReady(doc: Document, win: Window | null): Promise<void> {
  if (doc.fonts?.ready) {
    await Promise.race([
      doc.fonts.ready,
      new Promise<void>((resolve) => window.setTimeout(resolve, 3000)),
    ]);
  }

  const images = Array.from(doc.images ?? []);
  if (images.length > 0) {
    await Promise.race([
      Promise.all(
        images.map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                img.addEventListener('load', () => resolve(), { once: true });
                img.addEventListener('error', () => resolve(), { once: true });
              }),
        ),
      ),
      new Promise<void>((resolve) => window.setTimeout(resolve, 3000)),
    ]);
  }

  await new Promise<void>((resolve) => {
    const rafHost = win ?? window;
    rafHost.requestAnimationFrame(() => rafHost.requestAnimationFrame(() => resolve()));
  });
}

export async function exportPrintPdf(
  title: string,
  markdown: string,
  theme: ThemeMode,
  options?: ExportHtmlOptions,
): Promise<void> {
  const body = await renderMarkdownToStaticHtmlBody(markdown, theme === 'dark' ? 'light' : theme);
  const katexCss = body.includes('class="katex"') ? await collectKatexStyles() : '';
  const fullHtml = buildStandaloneHtmlDocument(title, body, 'light', katexCss, options);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-9999px';
  iframe.style.top = '0';
  iframe.style.width = '860px';
  iframe.style.height = '600px';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const cleanup = () => {
    if (iframe.isConnected) {
      iframe.remove();
    }
  };

  const doc = iframe.contentDocument;
  if (doc) {
    doc.open();
    doc.write(fullHtml);
    doc.close();
    await waitForPrintDocumentReady(doc, iframe.contentWindow);
    iframe.contentWindow?.addEventListener('afterprint', cleanup, { once: true });
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    window.setTimeout(cleanup, 60000);
  } else {
    cleanup();
  }
}

export async function copyAsRichText(markdown: string, theme: ThemeMode): Promise<void> {
  const effectiveTheme: ThemeMode = theme === 'dark' ? 'light' : theme;
  const rawHtml = await renderMarkdownToStaticHtmlBody(markdown, effectiveTheme);
  const html = stripKatexMathml(rawHtml);
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    const item = new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([markdown], { type: 'text/plain' }),
    });
    await navigator.clipboard.write([item]);
    return;
  }
  await navigator.clipboard.writeText(markdown);
}
