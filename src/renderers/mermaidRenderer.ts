export type ThemeMode = 'light' | 'dark' | 'sepia';

let mermaidPromise: Promise<typeof import('mermaid')['default']> | null = null;
let renderCounter = 0;
let renderQueue: Promise<unknown> = Promise.resolve();
let lastTheme: string | null = null;

const MAX_MERMAID_CACHE = 64;
const mermaidCache = new Map<string, string>();

async function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid')
      .then((mod) => mod.default)
      .catch((err) => {
        mermaidPromise = null;
        throw err;
      });
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

  const targetTheme = themeMode === 'dark' ? 'dark' : themeMode === 'sepia' ? 'neutral' : 'default';
  const cacheKey = `${targetTheme}\0${trimmed}`;
  const cached = mermaidCache.get(cacheKey);
  if (cached !== undefined) {
    mermaidCache.delete(cacheKey);
    mermaidCache.set(cacheKey, cached);
    return { svg: cached };
  }

  const run = async (): Promise<{ svg: string; error?: string }> => {
    const againCached = mermaidCache.get(cacheKey);
    if (againCached !== undefined) {
      mermaidCache.delete(cacheKey);
      mermaidCache.set(cacheKey, againCached);
      return { svg: againCached };
    }

    const id = `prismamd-mmd-${++renderCounter}`;
    try {
      const mermaid = await getMermaid();

      if (lastTheme !== targetTheme) {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
          logLevel: 'fatal',
          theme: targetTheme,
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        });
        lastTheme = targetTheme;
      }

      const result = await mermaid.render(id, trimmed);
      if (result.svg) {
        if (mermaidCache.size >= MAX_MERMAID_CACHE) {
          const oldestKey = mermaidCache.keys().next().value;
          if (oldestKey !== undefined) {
            mermaidCache.delete(oldestKey);
          }
        }
        mermaidCache.set(cacheKey, result.svg);
      }
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
