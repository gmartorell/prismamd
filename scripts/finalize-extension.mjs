import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { generateIcons } from './generate-icons.mjs';

const root = process.cwd();
const distExt = path.join(root, 'dist-extension');

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

const htmlPath = path.join(distExt, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
if (/https?:\/\/[^"'\s]+\.(js|css)/i.test(html)) {
  throw new Error('MV3 violation: remote script/stylesheet URL found in dist-extension/index.html');
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
