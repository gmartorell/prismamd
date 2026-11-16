let katexPromise: Promise<typeof import('katex')['default']> | null = null;
const MAX_KATEX_CACHE = 200;
const katexCache = new Map<string, string>();

async function getKatex() {
  if (!katexPromise) {
    katexPromise = Promise.all([
      import('katex'),
      import('katex/dist/katex.min.css'),
    ])
      .then(([mod]) => mod.default)
      .catch((err) => {
        katexPromise = null;
        throw err;
      });
  }
  return katexPromise;
}

export async function renderLatexHtml(
  latex: string,
  displayMode: boolean,
): Promise<{ html: string; error?: string }> {
  const trimmed = latex.trim();
  if (!trimmed) {
    return { html: '', error: '' };
  }

  const cacheKey = `${displayMode ? 'D' : 'I'}:${trimmed}`;
  const cached = katexCache.get(cacheKey);
  if (cached !== undefined) {
    katexCache.delete(cacheKey);
    katexCache.set(cacheKey, cached);
    return { html: cached };
  }

  try {
    const katex = await getKatex();
    const html = katex.renderToString(trimmed, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
      maxSize: 50,
      maxExpand: 1000,
    });
    if (katexCache.size >= MAX_KATEX_CACHE) {
      const oldestKey = katexCache.keys().next().value;
      if (oldestKey !== undefined) {
        katexCache.delete(oldestKey);
      }
    }
    katexCache.set(cacheKey, html);
    return { html };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { html: '', error: message };
  }
}
