import type { JSONContent } from '@tiptap/core';
import { markdownToProseMirrorDoc } from '../markdown/bridge';
import { renderLatexHtml } from '../renderers/katexRenderer';
import { renderMermaidSvg, type ThemeMode } from '../renderers/mermaidRenderer';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function renderInlineNodes(nodes: JSONContent[] | undefined): Promise<string> {
  if (!nodes || nodes.length === 0) return '';
  const parts: string[] = [];

  for (const node of nodes) {
    if (node.type === 'text') {
      let html = escapeHtml(node.text ?? '');
      const marks = node.marks ?? [];
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
            const href = escapeHtml(String(mark.attrs?.href ?? ''));
            const title = mark.attrs?.title ? ` title="${escapeHtml(String(mark.attrs.title))}"` : '';
            html = `<a href="${href}"${title} target="_blank" rel="noopener noreferrer">${html}</a>`;
            break;
          }
          default:
            break;
        }
      }
      parts.push(html);
    } else if (node.type === 'hardBreak') {
      parts.push('<br />');
    } else if (node.type === 'image') {
      const src = escapeHtml(String(node.attrs?.src ?? ''));
      const alt = escapeHtml(String(node.attrs?.alt ?? ''));
      const title = node.attrs?.title ? ` title="${escapeHtml(String(node.attrs.title))}"` : '';
      parts.push(`<img src="${src}" alt="${alt}"${title} style="max-width:100%;height:auto;border-radius:6px;" />`);
    } else if (node.type === 'mathInline') {
      const latex = String(node.attrs?.latex ?? '');
      const rendered = await renderLatexHtml(latex, false);
      parts.push(`<span class="math-inline">${rendered.html || `<code>$${escapeHtml(latex)}$</code>`}</span>`);
    } else if (node.type === 'rawHtmlInline') {
      parts.push(String(node.attrs?.value ?? ''));
    }
  }

  return parts.join('');
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
        const kind = String(node.attrs?.alertType ?? 'NOTE').toUpperCase();
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
        const start = Number(node.attrs?.start ?? 1);
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
            const align = cell.attrs?.textAlign ? ` style="text-align:${escapeHtml(String(cell.attrs.textAlign))}"` : '';
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
      case 'rawHtmlBlock':
        out.push(String(node.attrs?.value ?? ''));
        break;
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

function buildStandaloneHtmlDocument(
  title: string,
  bodyHtml: string,
  theme: ThemeMode,
  katexCss: string,
): string {
  const isDark = theme === 'dark';
  const isSepia = theme === 'sepia';
  const bg = isDark ? '#0f141b' : isSepia ? '#f7f1e3' : '#ffffff';
  const fg = isDark ? '#e6edf3' : isSepia ? '#3b2f24' : '#1f2328';
  const border = isDark ? '#30363d' : isSepia ? '#dccbb0' : '#d0d7de';
  const codeBg = isDark ? '#161b22' : isSepia ? '#efe6d5' : '#f6f8fa';

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
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
  .math-block { margin: 1.2em 0; text-align: center; overflow-x: auto; }
  @media print {
    body { background: #fff !important; color: #111 !important; padding: 0; }
    pre, table, .mermaid-export, .github-alert, .math-block { break-inside: avoid; }
    .math-block { overflow: visible; }
  }
  ${katexCss}
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
): Promise<void> {
  const body = await renderMarkdownToStaticHtmlBody(markdown, theme);
  const katexCss = await collectKatexStyles();
  const fullHtml = buildStandaloneHtmlDocument(title, body, theme, katexCss);
  const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const cleanName = title.replace(/\.(md|markdown|mdx|mdown)$/i, '') || 'documento';
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
): Promise<void> {
  const body = await renderMarkdownToStaticHtmlBody(markdown, theme === 'dark' ? 'light' : theme);
  const katexCss = await collectKatexStyles();
  const fullHtml = buildStandaloneHtmlDocument(title, body, 'light', katexCss);
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
  const html = await renderMarkdownToStaticHtmlBody(markdown, theme);
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
