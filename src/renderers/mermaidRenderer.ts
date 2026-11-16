export type ThemeMode = 'light' | 'dark' | 'sepia';

let mermaidPromise: Promise<typeof import('mermaid')['default']> | null = null;
let renderCounter = 0;
let renderQueue: Promise<unknown> = Promise.resolve();
let lastTheme: string | null = null;

async function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => mod.default);
  }
  return mermaidPromise;
}

export async function renderMermaidSvg(
  code: string,
  themeMode: ThemeMode,
): Promise<{ svg: string; error?: string }> {
  const trimmed = code.trim();
  if (!trimmed) {
    return { svg: '', error: '' };
  }

  const run = async (): Promise<{ svg: string; error?: string }> => {
    const mermaid = await getMermaid();
    const targetTheme = themeMode === 'dark' ? 'dark' : themeMode === 'sepia' ? 'neutral' : 'default';

    if (lastTheme !== targetTheme) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: targetTheme,
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      });
      lastTheme = targetTheme;
    }

    const id = `prismamd-mmd-${++renderCounter}`;
    try {
      const result = await mermaid.render(id, trimmed);
      return { svg: result.svg };
    } catch (err) {
      if (typeof document !== 'undefined') {
        document.getElementById(`d${id}`)?.remove();
        document.getElementById(id)?.remove();
      }
      const message = err instanceof Error ? err.message : String(err);
      return { svg: '', error: message };
    }
  };

  const task = renderQueue.then(run, run);
  renderQueue = task.catch(() => undefined);
  return task;
}
