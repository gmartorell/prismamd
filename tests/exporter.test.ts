import { describe, expect, it, vi } from 'vitest';
import { exportPrintPdf, resolveCssUrls } from '../src/utils/exporter';

describe('exporter KaTeX font resolution and PDF print readiness', () => {
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

  it('embeds KaTeX styles with inlined woff2 fonts and waits before calling print()', async () => {
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
});
