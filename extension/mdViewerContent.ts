import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';

const MARKDOWN_PATH_RE = /\.(md|markdown|mdown|mdx)$/i;
const MAX_AUTO_PARSE_BYTES = 2 * 1024 * 1024; // 2 MB

interface ViewerStrings {
  defaultFilename: string;
  viewRaw: string;
  viewPreview: string;
  openInEditor: string;
  renderMarkdown: string;
  largeFileNotice: (sizeMb: string) => string;
}

function getViewerStrings(): ViewerStrings {
  const lang = (typeof navigator !== 'undefined' ? navigator.language : 'es') || 'es';
  if (lang.toLowerCase().startsWith('en')) {
    return {
      defaultFilename: 'document.md',
      viewRaw: 'View Raw',
      viewPreview: 'Preview',
      openInEditor: 'Open & edit in PrismaMD',
      renderMarkdown: 'Render Markdown',
      largeFileNotice: (sizeMb: string) =>
        `Large Markdown file (${sizeMb} MB) — opened in fast Raw view to keep the tab responsive.`,
    };
  }
  return {
    defaultFilename: 'documento.md',
    viewRaw: 'Ver Raw',
    viewPreview: 'Vista Previa',
    openInEditor: 'Abrir y editar en PrismaMD',
    renderMarkdown: 'Renderizar Markdown',
    largeFileNotice: (sizeMb: string) =>
      `Archivo Markdown grande (${sizeMb} MB) — abierto en vista Raw rápida para mantener la fluidez.`,
  };
}

function isRawMarkdownPage(): boolean {
  try {
    const parsed = new URL(window.location.href);
    if (!MARKDOWN_PATH_RE.test(parsed.pathname)) {
      return false;
    }

    const ct = (document.contentType || '').toLowerCase();
    if (ct === 'text/plain' || ct === 'text/markdown' || ct === 'text/x-markdown') {
      return true;
    }

    if (parsed.protocol === 'file:') {
      const children = document.body?.children;
      if (children && children.length === 1 && children[0].tagName === 'PRE') {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function getRawMarkdownText(): string {
  const pre = document.body?.querySelector('pre');
  if (pre) return pre.textContent ?? '';
  return document.body?.textContent ?? '';
}

function slugifyHeading(text: string, slugCounts: Map<string, number>): string {
  const base =
    text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'section';

  const seen = slugCounts.get(base) ?? 0;
  slugCounts.set(base, seen + 1);
  return seen === 0 ? base : `${base}-${seen}`;
}

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function resolveViewerLink(rawUrl: string): {
  href: string;
  isAnchor: boolean;
  isExternalOrigin: boolean;
} {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { href: '#', isAnchor: true, isExternalOrigin: false };
  }
  if (/^(javascript|vbscript|data):/i.test(trimmed)) {
    return { href: '#', isAnchor: true, isExternalOrigin: false };
  }
  if (trimmed.startsWith('#')) {
    return { href: trimmed, isAnchor: true, isExternalOrigin: false };
  }

  try {
    const resolved = new URL(trimmed, window.location.href);
    const proto = resolved.protocol.toLowerCase();
    if (proto === 'http:' || proto === 'https:' || proto === 'mailto:' || proto === 'file:') {
      const isExternalOrigin =
        (proto === 'http:' || proto === 'https:') && resolved.origin !== window.location.origin;
      return { href: resolved.href, isAnchor: false, isExternalOrigin };
    }
  } catch {
    // Fall through to safe '#' fallback
  }

  return { href: '#', isAnchor: true, isExternalOrigin: false };
}

function resolveViewerImageSrc(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (/^data:image\/(png|jpeg|jpg|gif|webp|avif);base64,/i.test(trimmed)) {
    return trimmed;
  }
  if (/^(javascript|vbscript|data):/i.test(trimmed)) {
    return '';
  }
  try {
    const resolved = new URL(trimmed, window.location.href);
    const proto = resolved.protocol.toLowerCase();
    if (proto === 'http:' || proto === 'https:' || proto === 'file:') {
      return resolved.href;
    }
  } catch {
    return '';
  }
  return '';
}

interface RenderContext {
  shadowRoot: ShadowRoot;
  slugCounts: Map<string, number>;
}

function renderInlineNodes(
  parent: HTMLElement,
  children: Array<Record<string, unknown>>,
  ctx: RenderContext,
): void {
  for (const node of children) {
    switch (node.type) {
      case 'text': {
        parent.appendChild(document.createTextNode(String(node.value ?? '')));
        break;
      }
      case 'strong': {
        const el = document.createElement('strong');
        renderInlineNodes(el, (node.children as Array<Record<string, unknown>>) ?? [], ctx);
        parent.appendChild(el);
        break;
      }
      case 'emphasis': {
        const el = document.createElement('em');
        renderInlineNodes(el, (node.children as Array<Record<string, unknown>>) ?? [], ctx);
        parent.appendChild(el);
        break;
      }
      case 'delete': {
        const el = document.createElement('del');
        renderInlineNodes(el, (node.children as Array<Record<string, unknown>>) ?? [], ctx);
        parent.appendChild(el);
        break;
      }
      case 'inlineCode': {
        const el = document.createElement('code');
        el.textContent = String(node.value ?? '');
        parent.appendChild(el);
        break;
      }
      case 'link': {
        const el = document.createElement('a');
        const resolved = resolveViewerLink(String(node.url ?? ''));
        el.href = resolved.href;
        if (resolved.isAnchor) {
          el.addEventListener('click', (event) => {
            const rawTarget = resolved.href.slice(1);
            if (!rawTarget) return;
            let decoded = rawTarget;
            try {
              decoded = decodeURIComponent(rawTarget);
            } catch {
              // Keep rawTarget if percent-decoding fails
            }
            const normalizedTarget = stripDiacritics(decoded.toLowerCase());
            const direct = ctx.shadowRoot.getElementById(decoded);
            const fallback =
              direct ??
              Array.from(ctx.shadowRoot.querySelectorAll<HTMLElement>('[id]')).find(
                (heading) => stripDiacritics(heading.id.toLowerCase()) === normalizedTarget,
              );
            if (fallback) {
              event.preventDefault();
              fallback.scrollIntoView({ behavior: 'smooth', block: 'start' });
              try {
                window.history.replaceState(null, '', resolved.href);
              } catch {
                // Ignore on restricted file:// histories
              }
            }
          });
        } else {
          el.rel = 'noopener noreferrer';
          if (resolved.isExternalOrigin) {
            el.target = '_blank';
          }
        }
        renderInlineNodes(el, (node.children as Array<Record<string, unknown>>) ?? [], ctx);
        parent.appendChild(el);
        break;
      }
      case 'image': {
        const safeSrc = resolveViewerImageSrc(String(node.url ?? ''));
        if (!safeSrc) break;
        const el = document.createElement('img');
        el.src = safeSrc;
        el.alt = String(node.alt ?? '');
        el.style.maxWidth = '100%';
        parent.appendChild(el);
        break;
      }
      case 'break': {
        parent.appendChild(document.createElement('br'));
        break;
      }
      default:
        break;
    }
  }
}

function renderBlockNodes(
  parent: HTMLElement,
  nodes: Array<Record<string, unknown>>,
  ctx: RenderContext,
): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'yaml': {
        const pre = document.createElement('pre');
        pre.className = 'pmd-frontmatter';
        pre.textContent = String(node.value ?? '');
        parent.appendChild(pre);
        break;
      }
      case 'heading': {
        const depth = Math.min(6, Math.max(1, Number(node.depth ?? 1)));
        const h = document.createElement(`h${depth}`);
        renderInlineNodes(h, (node.children as Array<Record<string, unknown>>) ?? [], ctx);
        h.id = slugifyHeading(h.textContent ?? '', ctx.slugCounts);
        parent.appendChild(h);
        break;
      }
      case 'paragraph': {
        const p = document.createElement('p');
        renderInlineNodes(p, (node.children as Array<Record<string, unknown>>) ?? [], ctx);
        parent.appendChild(p);
        break;
      }
      case 'blockquote': {
        const bq = document.createElement('blockquote');
        renderBlockNodes(bq, (node.children as Array<Record<string, unknown>>) ?? [], ctx);
        parent.appendChild(bq);
        break;
      }
      case 'code': {
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = String(node.value ?? '');
        pre.appendChild(code);
        parent.appendChild(pre);
        break;
      }
      case 'list': {
        const list = document.createElement(node.ordered ? 'ol' : 'ul');
        for (const item of (node.children as Array<Record<string, unknown>>) ?? []) {
          const li = document.createElement('li');
          const contentHost = document.createElement('div');
          contentHost.className = 'pmd-li-body';
          renderBlockNodes(contentHost, (item.children as Array<Record<string, unknown>>) ?? [], ctx);
          if (typeof item.checked === 'boolean') {
            li.className = 'pmd-task';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = item.checked;
            cb.disabled = true;
            li.append(cb, contentHost);
          } else {
            while (contentHost.firstChild) {
              li.appendChild(contentHost.firstChild);
            }
          }
          list.appendChild(li);
        }
        parent.appendChild(list);
        break;
      }
      case 'table': {
        const table = document.createElement('table');
        const rows = (node.children as Array<Record<string, unknown>>) ?? [];
        const aligns = (node.align as Array<string | null> | undefined) ?? [];
        rows.forEach((row, rIdx) => {
          const tr = document.createElement('tr');
          const cells = (row.children as Array<Record<string, unknown>>) ?? [];
          cells.forEach((cell, cIdx) => {
            const td = document.createElement(rIdx === 0 ? 'th' : 'td');
            const colAlign = aligns[cIdx];
            if (colAlign === 'left' || colAlign === 'center' || colAlign === 'right') {
              td.style.textAlign = colAlign;
            }
            renderInlineNodes(td, (cell.children as Array<Record<string, unknown>>) ?? [], ctx);
            tr.appendChild(td);
          });
          table.appendChild(tr);
        });
        parent.appendChild(table);
        break;
      }
      case 'thematicBreak': {
        parent.appendChild(document.createElement('hr'));
        break;
      }
      default:
        break;
    }
  }
}

function hideHostBodyContent(): void {
  if (!document.body) return;
  document.body.style.margin = '0';
  const stash = document.createElement('div');
  stash.id = 'prismamd-original-source';
  stash.hidden = true;
  stash.style.setProperty('display', 'none', 'important');
  while (document.body.firstChild) {
    stash.appendChild(document.body.firstChild);
  }
  document.body.appendChild(stash);
}

function mountMarkdownViewer(): void {
  if (!document.body || document.getElementById('prismamd-viewer-host')) return;
  if (!isRawMarkdownPage()) return;

  const rawText = getRawMarkdownText();
  if (!rawText) return;

  const strings = getViewerStrings();
  const byteSize = new Blob([rawText]).size;
  const isLargeFile = byteSize > MAX_AUTO_PARSE_BYTES;

  hideHostBodyContent();

  const host = document.createElement('div');
  host.id = 'prismamd-viewer-host';
  document.body.prepend(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; display: block; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
    .wrap { min-height: 100vh; background: #0d1117; color: #e6edf3; }
    @media (prefers-color-scheme: light) {
      .wrap { background: #ffffff; color: #18202c; }
      .bar { background: #f6f8fa !important; border-color: #e2e8f0 !important; color: #18202c !important; }
      .large-banner { background: #fffbeb !important; border-color: #fde68a !important; color: #78350f !important; }
      pre { background: #f6f8fa !important; border-color: #e2e8f0 !important; }
      code { background: #eff3f8 !important; }
      th, td { border-color: #d0d7de !important; }
      a { color: #0969da !important; }
    }
    .bar {
      position: sticky; top: 0; z-index: 10;
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 10px 18px; background: #131922; border-bottom: 1px solid #212936;
      font-size: 13px;
    }
    .brand { font-weight: 700; display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .actions { display: flex; gap: 8px; flex-shrink: 0; }
    button {
      padding: 6px 12px; border-radius: 6px; border: 1px solid #303a4a;
      background: #1b2432; color: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
    }
    button.primary { background: #2563eb; border-color: #2563eb; color: #ffffff; }
    .large-banner {
      max-width: 960px; margin: 16px auto 0; padding: 12px 16px; border-radius: 8px;
      border: 1px solid #854d0e; background: #1c1917; color: #fef08a;
      display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px;
    }
    article { max-width: 840px; margin: 0 auto; padding: 32px 24px 64px; line-height: 1.7; font-size: 15.5px; }
    h1, h2, h3, h4, h5, h6 { scroll-margin-top: 64px; }
    h1, h2 { border-bottom: 1px solid rgba(148,163,184,0.25); padding-bottom: 0.25em; }
    a { color: #58a6ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { font-family: ui-monospace, Menlo, Consolas, monospace; background: #1b2432; padding: 2px 5px; border-radius: 4px; font-size: 0.9em; }
    pre { background: #141b25; border: 1px solid #212936; padding: 14px; border-radius: 8px; overflow-x: auto; }
    pre code { background: transparent; padding: 0; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid #303a4a; padding: 8px 12px; }
    blockquote { border-left: 4px solid #58a6ff; margin: 1em 0; padding: 4px 16px; opacity: 0.9; }
    li.pmd-task { list-style: none; display: flex; align-items: flex-start; gap: 8px; }
    li.pmd-task input[type="checkbox"] { margin-top: 6px; flex-shrink: 0; }
    li.pmd-task .pmd-li-body { flex: 1; min-width: 0; }
    li.pmd-task .pmd-li-body > p:first-child { margin-top: 0; }
    li.pmd-task .pmd-li-body > p:last-child { margin-bottom: 0; }
    .raw-box { max-width: 960px; margin: 0 auto; padding: 24px; white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13.5px; line-height: 1.6; }
  `;

  const wrap = document.createElement('div');
  wrap.className = 'wrap';

  const bar = document.createElement('div');
  bar.className = 'bar';

  let filename = strings.defaultFilename;
  try {
    filename = decodeURIComponent(window.location.pathname.split('/').pop() || strings.defaultFilename);
  } catch {
    filename = window.location.pathname.split('/').pop() || strings.defaultFilename;
  }

  const brand = document.createElement('div');
  brand.className = 'brand';
  brand.textContent = `◆ PrismaMD · ${filename}`;

  const actions = document.createElement('div');
  actions.className = 'actions';

  let showingRaw = isLargeFile;
  let isRendered = false;

  const toggleBtn = document.createElement('button');
  toggleBtn.textContent = isLargeFile ? strings.renderMarkdown : strings.viewRaw;

  const openEditorBtn = document.createElement('button');
  openEditorBtn.className = 'primary';
  openEditorBtn.textContent = strings.openInEditor;
  openEditorBtn.addEventListener('click', () => {
    try {
      chrome.runtime.sendMessage(
        {
          type: 'OPEN_MD_IN_EDITOR',
          filename,
          content: rawText,
          sourceUrl: window.location.href,
        },
        () => {
          void chrome.runtime.lastError;
        },
      );
    } catch {
      // Ignore if extension context was invalidated
    }
  });

  actions.append(toggleBtn, openEditorBtn);
  bar.append(brand, actions);

  const renderedArticle = document.createElement('article');
  const rawPre = document.createElement('pre');
  rawPre.className = 'raw-box';
  rawPre.textContent = rawText;

  let largeBanner: HTMLDivElement | null = null;

  const ensureArticleRendered = () => {
    if (isRendered) return;
    const tree = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).use(remarkGfm).parse(rawText);
    const ctx: RenderContext = { shadowRoot: shadow, slugCounts: new Map() };
    renderBlockNodes(
      renderedArticle,
      (tree.children as unknown as Array<Record<string, unknown>>) ?? [],
      ctx,
    );
    isRendered = true;
    if (largeBanner) {
      largeBanner.remove();
      largeBanner = null;
    }
  };

  const syncViewVisibility = () => {
    renderedArticle.style.display = showingRaw ? 'none' : 'block';
    rawPre.style.display = showingRaw ? 'block' : 'none';
    if (showingRaw && !isRendered) {
      toggleBtn.textContent = strings.renderMarkdown;
    } else {
      toggleBtn.textContent = showingRaw ? strings.viewPreview : strings.viewRaw;
    }
  };

  if (!isLargeFile) {
    ensureArticleRendered();
  } else {
    largeBanner = document.createElement('div');
    largeBanner.className = 'large-banner';
    const noticeSpan = document.createElement('span');
    noticeSpan.textContent = strings.largeFileNotice((byteSize / (1024 * 1024)).toFixed(1));
    const renderNowBtn = document.createElement('button');
    renderNowBtn.className = 'primary';
    renderNowBtn.textContent = strings.renderMarkdown;
    renderNowBtn.addEventListener('click', () => {
      ensureArticleRendered();
      showingRaw = false;
      syncViewVisibility();
    });
    largeBanner.append(noticeSpan, renderNowBtn);
  }

  toggleBtn.addEventListener('click', () => {
    if (showingRaw) {
      ensureArticleRendered();
      showingRaw = false;
    } else {
      showingRaw = true;
    }
    syncViewVisibility();
  });

  syncViewVisibility();

  if (largeBanner) {
    wrap.append(bar, largeBanner, renderedArticle, rawPre);
  } else {
    wrap.append(bar, renderedArticle, rawPre);
  }
  shadow.append(style, wrap);
}

mountMarkdownViewer();
