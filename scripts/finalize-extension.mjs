import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { generateIcons } from './generate-icons.mjs';

const root = process.cwd();
const distExt = path.join(root, 'dist-extension');
const assetsDir = path.join(distExt, 'assets');

function stripLegacyFontsAndRewriteKatexCss(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(dir, entry.name);
    if (/\.woff$/i.test(entry.name) || /\.ttf$/i.test(entry.name)) {
      fs.unlinkSync(full);
      continue;
    }
    if (entry.name.startsWith('lazy-katex') && entry.name.endsWith('.css')) {
      const css = fs.readFileSync(full, 'utf8');
      const cleaned = css
        .replace(
          /,\s*url\(\s*['"]?[^)'"]+\.(?:woff|ttf)(?:\?[^)'"]*)?['"]?\s*\)\s*format\(\s*['"](?:woff|truetype)['"]\s*\)/gi,
          '',
        )
        .replace(
          /url\(\s*['"]?[^)'"]+\.(?:woff|ttf)(?:\?[^)'"]*)?['"]?\s*\)\s*format\(\s*['"](?:woff|truetype)['"]\s*\)\s*,\s*/gi,
          '',
        );
      fs.writeFileSync(full, cleaned, 'utf8');
    }
  }
}

stripLegacyFontsAndRewriteKatexCss(assetsDir);

generateIcons(path.join(distExt, 'icons'), [16, 48, 128]);
fs.copyFileSync(path.join(root, 'extension', 'manifest.json'), path.join(distExt, 'manifest.json'));

await build({
  entryPoints: [path.join(root, 'extension', 'background.ts')],
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  minify: true,
  outfile: path.join(distExt, 'background.js'),
});

await build({
  entryPoints: [path.join(root, 'extension', 'mdViewerContent.ts')],
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  minify: true,
  outfile: path.join(distExt, 'mdViewerContent.js'),
});

function collectHtmlAndCssFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectHtmlAndCssFiles(full));
    } else if (/\.(html|css)$/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const REMOTE_HTML_ASSET_RE =
  /<(?:script|img|iframe|audio|video|source|embed)\b[^>]*\bsrc\s*=\s*['"]?\s*https?:\/\/|<link\b[^>]*\bhref\s*=\s*['"]?\s*https?:\/\//i;
const REMOTE_CSS_ASSET_RE =
  /@import\s+(?:url\(\s*)?['"]?\s*https?:\/\/|url\(\s*['"]?\s*https?:\/\//i;

for (const filePath of collectHtmlAndCssFiles(distExt)) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relPath = path.relative(root, filePath);
  if (
    (filePath.toLowerCase().endsWith('.html') && REMOTE_HTML_ASSET_RE.test(content)) ||
    REMOTE_CSS_ASSET_RE.test(content)
  ) {
    throw new Error(`MV3 Zero-CDN violation: remote http(s):// asset reference found in ${relPath}`);
  }
}

const zipPath = path.join(root, 'dist-extension.zip');
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
const topEntries = fs.readdirSync(distExt);
execFileSync('python3', ['-m', 'zipfile', '-c', zipPath, ...topEntries], { cwd: distExt });

const zipListing = execFileSync('python3', ['-m', 'zipfile', '-l', zipPath], { encoding: 'utf8' });
if (!/^\s*manifest\.json\b/m.test(zipListing)) {
  throw new Error('Chrome Web Store package error: manifest.json must be at the root of dist-extension.zip');
}

console.log('Finalized Chromium MV3 extension in dist-extension/ and dist-extension.zip');
