import fs from 'node:fs';
import path from 'node:path';
import { generateIcons } from './generate-icons.mjs';

const root = process.cwd();
const distPwa = path.join(root, 'dist-pwa');

const extManifest = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'));
const appVersion = String(extManifest.version || '0.0.0.0');

generateIcons(path.join(distPwa, 'icons'), [192, 512]);
fs.copyFileSync(path.join(root, 'pwa', 'manifest.webmanifest'), path.join(distPwa, 'manifest.webmanifest'));
fs.writeFileSync(
  path.join(distPwa, 'version.json'),
  `${JSON.stringify({ version: appVersion, target: 'pwa' }, null, 2)}\n`,
  'utf8',
);

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

const assets = ['./', ...collectRelativeFiles(distPwa)];
const swTemplate = fs.readFileSync(path.join(root, 'pwa', 'sw.js'), 'utf8');
const swOut = swTemplate.replace('/*__PRECACHE_ASSETS__*/ []', JSON.stringify(assets, null, 2));
fs.writeFileSync(path.join(distPwa, 'sw.js'), swOut, 'utf8');

console.log(`Finalized PWA build in dist-pwa/ (${assets.length} precached entries).`);
