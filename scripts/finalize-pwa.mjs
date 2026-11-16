import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { generateIcons } from './generate-icons.mjs';

const root = process.cwd();
const distPwa = path.join(root, 'dist-pwa');
const assetsDir = path.join(distPwa, 'assets');

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

const extManifest = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'));
const appVersion = String(extManifest.version || '0.0.0.0');

generateIcons(path.join(distPwa, 'icons'), [192, 512]);
fs.copyFileSync(path.join(root, 'pwa', 'manifest.webmanifest'), path.join(distPwa, 'manifest.webmanifest'));

function collectRelativeFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectRelativeFiles(full, base));
    } else {
      const rel = `./${path.relative(base, full).replace(/\\/g, '/')}`;
      if (rel !== './sw.js' && rel !== './version.json') out.push(rel);
    }
  }
  return out;
}

const allFiles = collectRelativeFiles(distPwa).sort();

const buildHash = crypto
  .createHash('sha256')
  .update(allFiles.join('\n'))
  .digest('hex')
  .slice(0, 8);

fs.writeFileSync(
  path.join(distPwa, 'version.json'),
  `${JSON.stringify({ version: appVersion, buildHash, target: 'pwa' }, null, 2)}\n`,
  'utf8',
);

function isLazyAsset(rel) {
  const base = path.posix.basename(rel);
  if (base.startsWith('lazy-') || base.toLowerCase().endsWith('.woff2')) {
    return true;
  }
  if (rel.startsWith('./assets/') && !base.startsWith('index-') && !base.startsWith('vendor-')) {
    return true;
  }
  return false;
}

const corePrecacheAssets = ['./', ...allFiles.filter((rel) => !isLazyAsset(rel))];
const lazyWarmAssets = allFiles.filter((rel) => isLazyAsset(rel));

const swTemplate = fs.readFileSync(path.join(root, 'pwa', 'sw.js'), 'utf8');
const swOut = swTemplate
  .replace(/const CACHE_NAME = '[^']+';/, `const CACHE_NAME = 'prismamd-${appVersion}-${buildHash}';`)
  .replace('/*__CORE_PRECACHE_ASSETS__*/ []', JSON.stringify(corePrecacheAssets, null, 2))
  .replace('/*__LAZY_WARM_ASSETS__*/ []', JSON.stringify(lazyWarmAssets, null, 2));

fs.writeFileSync(path.join(distPwa, 'sw.js'), swOut, 'utf8');

console.log(
  `Finalized PWA build in dist-pwa/ (hash: ${buildHash}, ${corePrecacheAssets.length} core precached, ${lazyWarmAssets.length} lazy warm entries).`,
);
