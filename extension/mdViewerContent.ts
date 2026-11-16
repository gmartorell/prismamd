import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';

function isRawMarkdownPage(): boolean {
  if (document.contentType === 'text/plain' || document.contentType === 'text/markdown') {
    return true;
  }
  const children = document.body?.children;
  if (children && children.length === 1 && children[0].tagName === 'PRE') {
    return true;
  }
  return false;
}

function getRawMarkdownText(): string {
  const pre = document.body?.querySelector('pre');
  if (pre) return pre.textContent ?? '';
  return document.body?.innerText ?? '';
}

function renderInlineNodes(parent: HTMLElement, children: Array<Record<string, unknown>>): void {
  for (const node of children) {
    switch (node.type) {
      case 'text': {
        parent.appendChild(document.createTextNode(String(node.value ?? '')));
        break;
      }
      case 'strong': {
        const el = document.createElement('strong');
        renderInlineNodes(el, (node.children as Array<Record<string, unknown>>) ?? []);
        parent.appendChild(el);
        break;
      }
      case 'emphasis': {
        const el = document.createElement('em');
        renderInlineNodes(el, (node.children as Array<Record<string, unknown>>) ?? []);
        parent.appendChild(el);
        break;
      }
      case 'delete': {
        const el = document.createElement('del');
        renderInlineNodes(el, (node.children as Array<Record<string, unknown>>) ?? []);
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
        const url = String(node.url ?? '#');
        el.href = /^(https?:|mailto:|#|\/)/i.test(url) ? url : '#';
        el.target = '_blank';
        el.rel = 'noopener noreferrer';
        renderInlineNodes(el, (node.children as Array<Record<string, unknown>>) ?? []);
        parent.appendChild(el);
        break;
      }
      case 'image': {
        const el = document.createElement('img');
        el.src = String(node.url ?? '');
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

function renderBlockNodes(parent: HTMLElement, nodes: Array<Record<string, unknown>>): void {
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
        renderInlineNodes(h, (node.children as Array<Record<string, unknown>>) ?? []);
        parent.appendChild(h);
        break;
      }
      case 'paragraph': {
        const p = document.createElement('p');
        renderInlineNodes(p, (node.children as Array<Record<string, unknown>>) ?? []);
        parent.appendChild(p);
        break;
      }
      case 'blockquote': {
        const bq = document.createElement('blockquote');
        renderBlockNodes(bq, (node.children as Array<Record<string, unknown>>) ?? []);
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
          if (typeof item.checked === 'boolean') {
            li.className = 'pmd-task';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = item.checked;
            cb.disabled = true;
            li.appendChild(cb);
          }
          renderBlockNodes(li, (item.children as Array<Record<string, unknown>>) ?? []);
          list.appendChild(li);
        }
        parent.appendChild(list);
        break;
      }
      case 'table': {
        const table = document.createElement('table');
        const rows = (node.children as Array<Record<string, unknown>>) ?? [];
        rows.forEach((row, rIdx) => {
          const tr = document.createElement('tr');
          for (const cell of (row.children as Array<Record<string, unknown>>) ?? []) {
            const td = document.createElement(rIdx === 0 ? 'th' : 'td');
            renderInlineNodes(td, (cell.children as Array<Record<string, unknown>>) ?? []);
            tr.appendChild(td);
          }
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

function mountMarkdownViewer(): void {
  if (!isRawMarkdownPage()) return;
  const rawText = getRawMarkdownText();
  if (!rawText) return;

  const originalPre = document.body.querySelector('pre') as HTMLElement | null;
  if (originalPre) originalPre.style.display = 'none';

  const host = document.createElement('div');
  host.id = 'prismamd-viewer-host';
  document.body.prepend(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
    .wrap { min-height: 100vh; background: #0d1117; color: #e6edf3; }
    @media (prefers-color-scheme: light) {
      .wrap { background: #ffffff; color: #18202c; }
      .bar { background: #f6f8fa !important; border-color: #e2e8f0 !important; color: #18202c !important; }
      pre { background: #f6f8fa !important; border-color: #e2e8f0 !important; }
      code { background: #eff3f8 !important; }
      th, td { border-color: #d0d7de !important; }
    }
    .bar {
      position: sticky; top: 0; z-index: 10;
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 18px; background: #131922; border-bottom: 1px solid #212936;
      font-size: 13px;
    }
    .brand { font-weight: 700; display: flex; align-items: center; gap: 8px; }
    .actions { display: flex; gap: 8px; }
    button {
      padding: 6px 12px; border-radius: 6px; border: 1px solid #303a4a;
      background: #1b2432; color: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
    }
    button.primary { background: #2563eb; border-color: #2563eb; color: #ffffff; }
    article { max-width: 840px; margin: 0 auto; padding: 32px 24px 64px; line-height: 1.7; font-size: 15.5px; }
    h1, h2 { border-bottom: 1px solid rgba(148,163,184,0.25); padding-bottom: 0.25em; }
    code { font-family: ui-monospace, Menlo, Consolas, monospace; background: #1b2432; padding: 2px 5px; border-radius: 4px; font-size: 0.9em; }
    pre { background: #141b25; border: 1px solid #212936; padding: 14px; border-radius: 8px; overflow-x: auto; }
    pre code { background: transparent; padding: 0; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid #303a4a; padding: 8px 12px; }
    blockquote { border-left: 4px solid #58a6ff; margin: 1em 0; padding: 4px 16px; opacity: 0.9; }
    li.pmd-task { list-style: none; display: flex; align-items: flex-start; gap: 8px; }
    li.pmd-task p { margin: 0; }
    .raw-box { max-width: 960px; margin: 0 auto; padding: 24px; white-space: pre-wrap; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13.5px; line-height: 1.6; }
  `;

  const wrap = document.createElement('div');
  wrap.className = 'wrap';

  const bar = document.createElement('div');
  bar.className = 'bar';

  const filename = decodeURIComponent(window.location.pathname.split('/').pop() || 'documento.md');
  const brand = document.createElement('div');
  brand.className = 'brand';
  brand.textContent = `◆ PrismaMD · ${filename}`;

  const actions = document.createElement('div');
  actions.className = 'actions';

  let showingRaw = false;
  const toggleBtn = document.createElement('button');
  toggleBtn.textContent = 'Ver Raw';

  const openEditorBtn = document.createElement('button');
  openEditorBtn.className = 'primary';
  openEditorBtn.textContent = 'Abrir y editar en PrismaMD';
  openEditorBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      type: 'OPEN_MD_IN_EDITOR',
      filename,
      content: rawText,
      sourceUrl: window.location.href,
    });
  });

  actions.append(toggleBtn, openEditorBtn);
  bar.append(brand, actions);

  const renderedArticle = document.createElement('article');
  const tree = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).use(remarkGfm).parse(rawText);
  renderBlockNodes(renderedArticle, (tree.children as unknown as Array<Record<string, unknown>>) ?? []);

  const rawPre = document.createElement('pre');
  rawPre.className = 'raw-box';
  rawPre.textContent = rawText;
  rawPre.style.display = 'none';

  toggleBtn.addEventListener('click', () => {
    showingRaw = !showingRaw;
    renderedArticle.style.display = showingRaw ? 'none' : 'block';
    rawPre.style.display = showingRaw ? 'block' : 'none';
    toggleBtn.textContent = showingRaw ? 'Vista Previa' : 'Ver Raw';
  });

  wrap.append(bar, renderedArticle, rawPre);
  shadow.append(style, wrap);
}

mountMarkdownViewer();
