import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = process.cwd();
const distPwa = path.join(root, 'dist-pwa');
const artifactDir = process.env.E2E_ARTIFACT_DIR || path.join(root, 'test-results');
fs.mkdirSync(artifactDir, { recursive: true });

function resolveChromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const pwPath = chromium.executablePath?.();
  if (pwPath && fs.existsSync(pwPath)) return pwPath;
  return undefined;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

function startStaticServer(dir) {
  const resolvedDir = path.resolve(dir);
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const reqPath = (req.url || '/').split('?')[0];
      const rel = reqPath === '/' ? 'index.html' : reqPath.replace(/^\/+/, '');
      const fullPath = path.resolve(resolvedDir, rel);
      if (
        (fullPath !== resolvedDir && !fullPath.startsWith(`${resolvedDir}${path.sep}`)) ||
        !fs.existsSync(fullPath) ||
        fs.statSync(fullPath).isDirectory()
      ) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      const ext = path.extname(fullPath).toLowerCase();
      res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
      fs.createReadStream(fullPath).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
  });
}

function assert(cond, msg) {
  if (!cond) {
    throw new Error(`E2E Assertion failed: ${msg}`);
  }
}

async function run() {
  const { server, port } = await startStaticServer(distPwa);
  const url = `http://127.0.0.1:${port}/`;

  const executablePath = resolveChromeExecutable();
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('response', (res) => {
      if (res.status() >= 400) consoleErrors.push(`HTTP ${res.status()} ${res.url()}`);
    });

    const t0 = performance.now();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.raw-editor-host .cm-content');
    await page.waitForSelector('.preview-prosemirror');
    const mountMs = Math.round(performance.now() - t0);

    // Wait for lazy Mermaid & KaTeX chunks to render
    await page.waitForSelector('.pm-mermaid-svg svg', { timeout: 10000 });
    await page.waitForSelector('.katex', { timeout: 10000 });

    const svgBox = await page.locator('.pm-mermaid-svg svg').first().boundingBox();
    const katexCount = await page.locator('.katex').count();
    assert(svgBox && svgBox.width > 40 && svgBox.height > 20, 'Mermaid SVG rendered with visible box');
    assert(katexCount >= 2, `Expected >=2 rendered KaTeX nodes, found ${katexCount}`);

    // Screenshot 1: Split view in Dark theme
    await page.screenshot({ path: path.join(artifactDir, 'split-view-dark.png') });

    // Regression: switching language in Split View on unmodified scratchpad updates BOTH Raw & Preview immediately
    await page.locator('[data-testid="lang-select"]').selectOption('en');
    await page.waitForTimeout(250);
    const rawEn = await page.locator('.raw-editor-host .cm-content').innerText();
    const previewEn = await page.locator('.preview-prosemirror').innerText();
    assert(rawEn.includes('# PrismaMD: Fast, Raw & Preview'), `Expected English heading in Raw editor, got '${rawEn.slice(0, 100)}'`);
    assert(previewEn.includes('PrismaMD: Fast, Raw & Preview') && previewEn.includes('Preview'), 'Expected English content in Preview editor');

    await page.locator('[data-testid="lang-select"]').selectOption('es');
    await page.waitForTimeout(250);
    const rawEs = await page.locator('.raw-editor-host .cm-content').innerText();
    const previewEs = await page.locator('.preview-prosemirror').innerText();
    assert(rawEs.includes('Vista Previa'), 'Expected Spanish "Vista Previa" in Raw editor after switching back to es');
    assert(previewEs.includes('Vista Previa'), 'Expected Spanish "Vista Previa" in Preview editor after switching back to es');

    // Test Preview -> Raw bidirectional sync (toggle unchecked task item)
    const uncheckedBox = page.locator('.preview-prosemirror ul[data-type="taskList"] > li[data-checked="false"] input[type="checkbox"]').first();
    await uncheckedBox.click();
    await page.waitForTimeout(250);
    const rawAfterCheck = await page.locator('.raw-editor-host .cm-content').innerText();
    assert(rawAfterCheck.includes('[x] Abre una carpeta'), 'Preview task checkbox toggle synced to Raw editor');

    // Test Preview View + Sepia Theme + English i18n
    await page.locator('[data-testid="view-preview"]').click();
    await page.locator('[data-testid="theme-select"]').selectOption('sepia');
    await page.locator('[data-testid="lang-select"]').selectOption('en');
    await page.waitForTimeout(450);

    const themeAttr = await page.evaluate(() => document.documentElement.dataset.theme);
    assert(themeAttr === 'sepia', `Expected theme sepia, got ${themeAttr}`);
    const firstTabText = await page.locator('.tab-item.scratchpad .tab-title').innerText();
    assert(firstTabText.includes('Quick Note'), `Expected English tab label 'Quick Note', got '${firstTabText}'`);

    await page.waitForSelector('.pm-mermaid-svg svg', { timeout: 10000 });
    await page.evaluate(() => {
      const scroller = document.querySelector('.preview-editor-scroller');
      if (scroller) scroller.scrollTop = 360;
    });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(artifactDir, 'preview-view-sepia.png') });

    // Switch back to ES + Light + Split View, then test Base64 folding in Raw View
    await page.locator('[data-testid="lang-select"]').selectOption('es');
    await page.locator('[data-testid="theme-select"]').selectOption('light');
    await page.locator('[data-testid="view-split"]').click();
    await page.waitForSelector('.raw-editor-host .cm-content');

    // Use real PNG icon from dist-extension/icons/icon-48.png or dist-pwa/icons/icon-192.png (>200 chars Base64)
    const extIconPath = path.join(root, 'dist-extension', 'icons', 'icon-48.png');
    const pwaIconPath = path.join(root, 'dist-pwa', 'icons', 'icon-192.png');
    const iconPath = fs.existsSync(extIconPath) ? extIconPath : pwaIconPath;
    const pngBase64 = fs.readFileSync(iconPath).toString('base64');
    assert(pngBase64.length > 200, 'Sample PNG base64 must exceed 120-char folding threshold');

    const cmContent = page.locator('.raw-editor-host .cm-content');
    await cmContent.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(`\n\n![icono prismamd](data:image/png;base64,${pngBase64})\n`);

    await page.waitForSelector('.cm-base64-chip', { timeout: 5000 });
    await page.waitForSelector('.preview-prosemirror img[src^="data:image/png;base64,"]', { timeout: 5000 });

    const chipText = await page.locator('.cm-base64-chip').first().innerText();
    const imgLoaded = await page.evaluate(() => {
      const img = document.querySelector('.preview-prosemirror img[src^="data:image/png;base64,"]');
      return Boolean(img && img.complete && img.naturalWidth > 0);
    });
    assert(chipText.includes('base64/png'), `Expected base64/png chip, got '${chipText}'`);
    assert(imgLoaded, 'Base64 PNG image rendered cleanly in Preview editor');

    await page.evaluate(() => {
      const previewScroller = document.querySelector('.preview-editor-scroller');
      if (previewScroller) previewScroller.scrollTop = previewScroller.scrollHeight;
    });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(artifactDir, 'raw-base64-fold-light.png') });

    // Verify visible version pill and Version & Updates modal
    const versionBadgeText = await page.locator('[data-testid="status-version-btn"]').innerText();
    assert(/^v\d+\.\d+\.\d+\.\d+/.test(versionBadgeText.trim()), `Expected version badge, got '${versionBadgeText}'`);
    await page.locator('[data-testid="status-version-btn"]').click();
    await page.waitForSelector('[data-testid="about-current-version"]', { timeout: 5000 });
    await page.waitForSelector('.version-status-card.status-up-to-date', { timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // Regression: Export PDF embeds KaTeX woff2 Data URIs and waits for fonts before print()
    await page.evaluate(() => {
      const origCreate = document.createElement.bind(document);
      window.__pdfPrintResult = null;
      document.createElement = function (tag, opts) {
        const el = origCreate(tag, opts);
        if (String(tag).toLowerCase() === 'iframe') {
          const observer = new MutationObserver(() => {
            if (el.isConnected && el.contentDocument && el.contentWindow) {
              const doc = el.contentDocument;
              const win = el.contentWindow;
              win.print = () => {
                const fonts = Array.from(doc.fonts || []).map((f) => ({ family: f.family, status: f.status }));
                const katexBoxes = Array.from(doc.querySelectorAll('.katex')).map((k) => {
                  const r = k.getBoundingClientRect();
                  return { w: Math.round(r.width), h: Math.round(r.height) };
                });
                const html = doc.documentElement.outerHTML;
                window.__pdfPrintResult = {
                  loadedKatexFonts: fonts.filter((f) => f.family.startsWith('KaTeX') && f.status === 'loaded').length,
                  katexBoxes,
                  hasDataWoff2: html.includes('data:font/woff2;base64,'),
                  hasBrokenRelFont: html.includes('./KaTeX_'),
                };
              };
              observer.disconnect();
            }
          });
          observer.observe(document.body, { childList: true });
        }
        return el;
      };
    });
    await page.locator('[data-testid="export-menu-btn"]').click();
    await page.locator('.dropdown-menu .dropdown-item').nth(1).click();
    await page.waitForFunction(() => Boolean(window.__pdfPrintResult), {
      timeout: 10000,
    });
    const pdfResult = await page.evaluate(() => window.__pdfPrintResult);
    assert(pdfResult.hasDataWoff2, 'PDF print document should embed KaTeX woff2 Data URIs');
    assert(!pdfResult.hasBrokenRelFont, 'PDF print document must not retain unresolved ./KaTeX_ URLs');
    assert(pdfResult.loadedKatexFonts > 0, `Expected loaded KaTeX fonts in print iframe, got ${pdfResult.loadedKatexFonts}`);
    assert(
      pdfResult.katexBoxes.length >= 2 && pdfResult.katexBoxes.every((b) => b.w > 10 && b.h > 8),
      `Expected visible KaTeX formulas in print iframe, got ${JSON.stringify(pdfResult.katexBoxes)}`,
    );

    // Regression: Scratchpad ("Nota rápida") can be closed and replaced by a blank untitled tab
    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await page.locator('.tab-item.scratchpad .tab-close-btn').click();
    await page.waitForTimeout(200);
    const scratchpadCountAfterClose = await page.locator('.tab-item.scratchpad').count();
    const normalTabTitleAfterClose = await page.locator('.tab-item .tab-title').first().innerText();
    assert(scratchpadCountAfterClose === 0, 'Scratchpad tab should close when close button is clicked');
    assert(
      normalTabTitleAfterClose.trim().length > 0 && !normalTabTitleAfterClose.includes('Nota rápida'),
      `Expected fallback blank untitled tab after closing Scratchpad, got '${normalTabTitleAfterClose}'`,
    );

    assert(pageErrors.length === 0, `Page errors detected: ${pageErrors.join(' | ')}`);
    assert(consoleErrors.length === 0, `Console errors detected: ${consoleErrors.join(' | ')}`);

    // Mobile responsive check (390x844 & 360x780)
    const mobilePage = await browser.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    mobilePage.on('pageerror', (err) => pageErrors.push(err.message));
    await mobilePage.goto(url, { waitUntil: 'domcontentloaded' });
    await mobilePage.waitForSelector('.preview-prosemirror', { timeout: 10000 });
    await mobilePage.waitForTimeout(300);

    const mobileMetrics = await mobilePage.evaluate(() => {
      const stageRect = document.querySelector('.editor-stage')?.getBoundingClientRect();
      const switcherRect = document.querySelector('.view-switcher')?.getBoundingClientRect();
      const leftRect = document.querySelector('.toolbar-left')?.getBoundingClientRect();
      const sidebarPresent = Boolean(document.querySelector('.sidebar'));
      const statusBarRect = document.querySelector('.status-bar')?.getBoundingClientRect();
      return {
        innerWidth: window.innerWidth,
        docScrollWidth: document.documentElement.scrollWidth,
        stageWidth: Math.round(stageRect?.width ?? 0),
        sidebarClosedOnBoot: !sidebarPresent,
        switcherBelowLeft: Boolean(switcherRect && leftRect && switcherRect.top >= leftRect.bottom - 2),
        statusBarHeight: Math.round(statusBarRect?.height ?? 0),
      };
    });

    assert(mobileMetrics.docScrollWidth <= mobileMetrics.innerWidth, 'No horizontal overflow on mobile');
    assert(mobileMetrics.stageWidth >= 380, `Editor stage should fill mobile width, got ${mobileMetrics.stageWidth}`);
    assert(mobileMetrics.sidebarClosedOnBoot, 'Sidebar drawer should start closed on mobile boot');
    assert(mobileMetrics.switcherBelowLeft, 'Toolbar Row 2 (view switcher) should not overlap Row 1');
    assert(mobileMetrics.statusBarHeight <= 40, `Status bar should remain compact, got ${mobileMetrics.statusBarHeight}px`);

    await mobilePage.screenshot({ path: path.join(artifactDir, 'mobile-preview-390x844.png') });

    // Verify vertical split stack on mobile
    await mobilePage.locator('[data-testid="view-split"]').click();
    await mobilePage.waitForTimeout(250);
    const splitStack = await mobilePage.evaluate(() => {
      const raw = document.querySelector('.pane-raw')?.getBoundingClientRect();
      const prev = document.querySelector('.pane-preview')?.getBoundingClientRect();
      return Boolean(raw && prev && prev.top >= raw.bottom - 2 && raw.width >= 380);
    });
    assert(splitStack, 'Split mode on mobile should stack Raw above Preview at full width');
    await mobilePage.screenshot({ path: path.join(artifactDir, 'mobile-split-390x844.png') });

    assert(pageErrors.length === 0, `Page errors detected: ${pageErrors.join(' | ')}`);

    console.log(
      JSON.stringify(
        {
          ok: true,
          mountMs,
          mermaidSvgWidth: Math.round(svgBox.width),
          katexCount,
          chipText,
          imgLoaded,
          mobileMetrics,
          splitStack,
          pageErrors: pageErrors.length,
          consoleErrors: consoleErrors.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
