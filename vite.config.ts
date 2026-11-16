import fs from 'node:fs';
import { defineConfig } from 'vitest/config';

const target = process.env.BUILD_TARGET === 'extension' ? 'extension' : 'pwa';

function readAppVersion(): string {
  try {
    const manifest = JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8'));
    if (typeof manifest.version === 'string' && manifest.version.trim()) {
      return manifest.version.trim();
    }
  } catch {
    // Fallback to package.json
  }
  try {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    if (typeof pkg.version === 'string' && pkg.version.trim()) {
      return pkg.version.trim().replace(/-/g, '.');
    }
  } catch {
    // Ignore
  }
  return '0.0.0.0';
}

const appVersion = readAppVersion();

export default defineConfig({
  base: './',
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  define: {
    __BUILD_TARGET__: JSON.stringify(target),
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    outDir: target === 'extension' ? 'dist-extension' : 'dist-pwa',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        chunkFileNames(chunkInfo) {
          if (
            chunkInfo.name === 'index' ||
            chunkInfo.name.startsWith('vendor-') ||
            chunkInfo.name.startsWith('lazy-')
          ) {
            return 'assets/[name]-[hash].js';
          }
          return 'assets/lazy-[name]-[hash].js';
        },
        manualChunks(id) {
          if (id.includes('node_modules/katex')) {
            return 'lazy-katex';
          }
          if (
            id.includes('node_modules/cytoscape') ||
            id.includes('node_modules/cose-base') ||
            id.includes('node_modules/layout-base')
          ) {
            return 'lazy-mermaid-cytoscape';
          }
          if (id.includes('node_modules/elkjs')) {
            return 'lazy-mermaid-elk';
          }
          if (id.includes('node_modules/dagre') || id.includes('node_modules/d3')) {
            return 'lazy-mermaid-dagre';
          }
          if (
            id.includes('node_modules/@mermaid-js/parser') ||
            id.includes('node_modules/chevrotain') ||
            id.includes('node_modules/langium')
          ) {
            return 'lazy-mermaid-parser';
          }
          if (id.includes('node_modules/@codemirror') || id.includes('node_modules/codemirror') || id.includes('node_modules/@lezer')) {
            return 'vendor-codemirror';
          }
          if (id.includes('node_modules/@tiptap') || id.includes('node_modules/prosemirror') || id.includes('node_modules/lowlight') || id.includes('node_modules/highlight.js')) {
            return 'vendor-tiptap';
          }
          if (id.includes('node_modules/unified') || id.includes('node_modules/remark') || id.includes('node_modules/mdast') || id.includes('node_modules/micromark')) {
            return 'vendor-markdown';
          }
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
});
