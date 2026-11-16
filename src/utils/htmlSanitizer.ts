const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;

const ALLOWED_TAGS = new Set<string>([
  'div',
  'span',
  'p',
  'br',
  'hr',
  'kbd',
  'sub',
  'sup',
  'mark',
  'small',
  'ins',
  'del',
  's',
  'strong',
  'b',
  'em',
  'i',
  'code',
  'pre',
  'blockquote',
  'details',
  'summary',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'figure',
  'figcaption',
  'img',
  'a',
  'abbr',
  'ruby',
  'rt',
  'rp',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]);

const DROP_SUBTREE_TAGS = new Set<string>([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'button',
  'select',
  'option',
  'optgroup',
  'textarea',
  'base',
  'meta',
  'link',
  'svg',
  'math',
  'template',
  'noscript',
  'noembed',
  'noframes',
  'frame',
  'frameset',
  'title',
  'xmp',
  'plaintext',
  'head',
  'audio',
  'video',
  'source',
  'track',
  'canvas',
  'portal',
  'map',
  'area',
]);

const GLOBAL_ALLOWED_ATTRS = new Set<string>([
  'class',
  'title',
  'lang',
  'dir',
  'id',
  'style',
  'align',
  'aria-label',
  'aria-hidden',
]);

const TAG_ALLOWED_ATTRS: Record<string, ReadonlySet<string>> = {
  a: new Set(['href', 'target', 'rel']),
  img: new Set(['src', 'alt', 'width', 'height', 'loading', 'decoding']),
  ol: new Set(['start', 'reversed', 'type']),
  li: new Set(['value']),
  details: new Set(['open']),
  th: new Set(['colspan', 'rowspan', 'scope', 'width', 'height']),
  td: new Set(['colspan', 'rowspan', 'width', 'height']),
  table: new Set(['width']),
  blockquote: new Set(['cite']),
  ins: new Set(['cite', 'datetime']),
  del: new Set(['cite', 'datetime']),
};

const CLOBBERED_DOM_IDS = new Set<string>([
  'fonts',
  'images',
  'forms',
  'scripts',
  'links',
  'anchors',
  'embeds',
  'plugins',
  'styleSheets',
  'head',
  'body',
  'documentElement',
  'defaultView',
  'location',
  'domain',
  'cookie',
  'window',
  'parent',
  'top',
  'self',
  'frames',
  'contentWindow',
  'contentDocument',
]);

const SAFE_DATA_IMAGE_RE =
  /^data:image\/(?:png|jpeg|jpg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i;

const DANGEROUS_STYLE_VALUE_RE =
  /(?:expression|url|image-set)\s*\(|(?:javascript|vbscript|data)\s*:|behavior|-moz-binding|@import/i;

function escapeFallbackHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isSafeExportUrl(rawUrl: string, allowDataImage = false): boolean {
  if (typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;

  const normalizedNoWs = trimmed.replace(/[\u0000-\u0020\u007f]+/g, '');
  if (!normalizedNoWs) return false;

  if (normalizedNoWs.toLowerCase().startsWith('data:')) {
    if (!allowDataImage) return false;
    return (
      SAFE_DATA_IMAGE_RE.test(trimmed) &&
      /;base64,\s*[a-z0-9+/]/i.test(trimmed) &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(trimmed)
    );
  }

  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    return false;
  }

  if (trimmed.startsWith('#')) {
    return true;
  }

  // Block protocol-relative URLs (//evil.com, \\evil.com) while allowing single-slash root paths (/docs/a.md)
  if (/^(?:\/\/|\/\\|\\\\)/.test(trimmed)) {
    return false;
  }

  // If a colon appears before any '/', '?', or '#', it is an explicit URI scheme
  if (/^[^/?#]*:/.test(trimmed)) {
    if (/^https?:\/\/[^\s/]/i.test(trimmed)) {
      return true;
    }
    if (/^mailto:[^\s<>]+$/i.test(trimmed)) {
      return true;
    }
    return false;
  }

  // Relative paths: ./foo, ../foo, /foo, ?query, or bare relative filenames without scheme
  return true;
}

export function sanitizeInlineStyle(rawStyle: string): string {
  if (!rawStyle) return '';
  const withoutComments = rawStyle.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '');
  const declarations = withoutComments.split(';');
  const safeDeclarations: string[] = [];

  for (const decl of declarations) {
    const colonIdx = decl.indexOf(':');
    if (colonIdx <= 0) continue;

    const prop = decl.slice(0, colonIdx).trim().toLowerCase();
    const val = decl.slice(colonIdx + 1).trim();
    if (!prop || !val) continue;

    if (!/^[a-z][a-z0-9-]{0,39}$/.test(prop)) continue;
    if (prop === 'behavior' || prop === '-moz-binding') continue;

    if (
      val.includes('\\') ||
      val.includes('<') ||
      val.includes('>') ||
      /[\u0000-\u001f\u007f]/.test(val) ||
      DANGEROUS_STYLE_VALUE_RE.test(val)
    ) {
      continue;
    }

    safeDeclarations.push(`${prop}: ${val}`);
  }

  return safeDeclarations.join('; ');
}

function sanitizeElementAttributes(el: Element, tagName: string): void {
  const tagAttrs = TAG_ALLOWED_ATTRS[tagName];
  const attrNames = el.getAttributeNames();

  for (const rawName of attrNames) {
    const name = rawName.toLowerCase();
    const value = el.getAttribute(rawName) ?? '';

    if (name.startsWith('on') || name === 'srcdoc') {
      el.removeAttribute(rawName);
      continue;
    }

    const isAllowed =
      GLOBAL_ALLOWED_ATTRS.has(name) || (tagAttrs !== undefined && tagAttrs.has(name));
    if (!isAllowed) {
      el.removeAttribute(rawName);
      continue;
    }

    if (name === 'id') {
      const trimmedId = value.trim();
      if (
        !trimmedId ||
        !/^[a-zA-Z][a-zA-Z0-9_.:-]*$/.test(trimmedId) ||
        CLOBBERED_DOM_IDS.has(trimmedId)
      ) {
        el.removeAttribute(rawName);
      } else if (trimmedId !== value) {
        el.setAttribute('id', trimmedId);
      }
      continue;
    }

    if (name === 'style') {
      const cleanStyle = sanitizeInlineStyle(value);
      if (cleanStyle) {
        el.setAttribute('style', cleanStyle);
      } else {
        el.removeAttribute(rawName);
      }
      continue;
    }

    if (name === 'href') {
      if (isSafeExportUrl(value, false)) {
        el.setAttribute('href', value.trim());
      } else {
        el.setAttribute('href', '#');
      }
      continue;
    }

    if (name === 'src') {
      if (isSafeExportUrl(value, true)) {
        el.setAttribute('src', value.trim());
      } else {
        el.removeAttribute(rawName);
      }
      continue;
    }

    if (name === 'cite') {
      if (isSafeExportUrl(value, false)) {
        el.setAttribute('cite', value.trim());
      } else {
        el.removeAttribute(rawName);
      }
      continue;
    }

    if (name === 'target') {
      const lowerTarget = value.trim().toLowerCase();
      if (lowerTarget === '_blank' || lowerTarget === '_self') {
        el.setAttribute('target', lowerTarget);
      } else {
        el.removeAttribute(rawName);
      }
      continue;
    }

    if (name === 'align') {
      if (!/^(?:left|center|right|justify)$/i.test(value.trim())) {
        el.removeAttribute(rawName);
      }
      continue;
    }

    if (name === 'width' || name === 'height') {
      if (!/^\d{1,5}(?:px|%)?$/i.test(value.trim())) {
        el.removeAttribute(rawName);
      }
      continue;
    }

    if (name === 'colspan' || name === 'rowspan') {
      if (!/^\d{1,3}$/.test(value.trim())) {
        el.removeAttribute(rawName);
      }
      continue;
    }

    if (name === 'scope') {
      if (!/^(?:row|col|rowgroup|colgroup)$/i.test(value.trim())) {
        el.removeAttribute(rawName);
      }
      continue;
    }

    if (name === 'aria-hidden') {
      if (!/^(?:true|false)$/i.test(value.trim())) {
        el.removeAttribute(rawName);
      }
      continue;
    }
  }

  if (tagName === 'a' && el.getAttribute('target') === '_blank') {
    el.setAttribute('rel', 'noopener noreferrer');
  }
}

function sanitizeChildNodes(parent: Node): void {
  const children = Array.from(parent.childNodes);

  for (const child of children) {
    if (child.nodeType === COMMENT_NODE) {
      parent.removeChild(child);
      continue;
    }

    if (child.nodeType === TEXT_NODE) {
      continue;
    }

    if (child.nodeType !== ELEMENT_NODE) {
      parent.removeChild(child);
      continue;
    }

    const el = child as Element;
    const tagName = el.tagName.toLowerCase();

    if (el.namespaceURI !== XHTML_NS || DROP_SUBTREE_TAGS.has(tagName)) {
      parent.removeChild(el);
      continue;
    }

    if (!ALLOWED_TAGS.has(tagName)) {
      sanitizeChildNodes(el);
      while (el.firstChild) {
        parent.insertBefore(el.firstChild, el);
      }
      parent.removeChild(el);
      continue;
    }

    sanitizeElementAttributes(el, tagName);
    sanitizeChildNodes(el);
  }
}

export function sanitizeMarkdownHtml(rawHtml: string): string {
  if (!rawHtml) return '';
  if (typeof DOMParser === 'undefined') {
    return escapeFallbackHtml(rawHtml);
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(
    `<!DOCTYPE html><html><body>${rawHtml}</body></html>`,
    'text/html',
  );
  sanitizeChildNodes(doc.body);
  return doc.body.innerHTML;
}
