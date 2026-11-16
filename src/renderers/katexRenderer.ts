let katexPromise: Promise<typeof import('katex')['default']> | null = null;

async function getKatex() {
  if (!katexPromise) {
    katexPromise = Promise.all([
      import('katex'),
      import('katex/dist/katex.min.css'),
    ]).then(([mod]) => mod.default);
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

  try {
    const katex = await getKatex();
    const html = katex.renderToString(trimmed, {
      displayMode,
      throwOnError: false,
      strict: false,
    });
    return { html };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { html: '', error: message };
  }
}
