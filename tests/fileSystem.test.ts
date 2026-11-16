import { describe, expect, it, vi } from 'vitest';

const idbStore = new Map<string, unknown>();

vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => idbStore.get(key)),
  set: vi.fn(async (key: string, val: unknown) => {
    idbStore.set(key, val);
  }),
}));

import {
  ensureDirectoryPermission,
  isMarkdownFilename,
  loadSavedDirectoryHandle,
  loadSessionFromStorage,
  mergeOpenedFilesIntoTabs,
  mergeRestoredSessionTabs,
  normalizeViewMode,
  readDirectoryChildren,
  saveDirectoryHandle,
  subscribeLaunchQueue,
  updateDirectoryEntry,
  type EditorTab,
  type FolderEntry,
} from '../src/workspace/fileSystem';

describe('normalizeViewMode', () => {
  it('maps legacy human mode to preview', () => {
    expect(normalizeViewMode('human')).toBe('preview');
  });

  it('preserves valid view modes', () => {
    expect(normalizeViewMode('raw')).toBe('raw');
    expect(normalizeViewMode('split')).toBe('split');
    expect(normalizeViewMode('preview')).toBe('preview');
  });

  it('falls back on unknown or empty values', () => {
    expect(normalizeViewMode(undefined)).toBe('split');
    expect(normalizeViewMode(null)).toBe('split');
    expect(normalizeViewMode('invalid')).toBe('split');
    expect(normalizeViewMode('invalid', 'raw')).toBe('raw');
  });
});

describe('loadSessionFromStorage', () => {
  it('normalizes legacy human viewMode in persisted sessions', async () => {
    idbStore.clear();
    idbStore.set('prismamd.session.v1', {
      tabs: [],
      activeTabId: 'scratchpad',
      viewMode: 'human',
      theme: 'dark',
      explorerOpen: true,
      outlineOpen: false,
      scrollSync: true,
    });

    const { session } = await loadSessionFromStorage();
    expect(session?.viewMode).toBe('preview');
  });
});

describe('readDirectoryChildren and read-only folder support', () => {
  it('loads a single level skipping heavy directories and ignoring broken entries', async () => {
    const fakeEntries = [
      { kind: 'directory', name: '__pycache__' },
      { kind: 'directory', name: 'envs' },
      { kind: 'directory', name: 'node_modules' },
      { kind: 'directory', name: '.git' },
      { kind: 'directory', name: 'docs' },
      { kind: 'file', name: 'README.md' },
      { kind: 'file', name: 'script.py' },
      {
        kind: 'file',
        get name(): string {
          throw new Error('Broken symlink entry');
        },
      },
      { kind: 'file', name: 'TEST.md' },
    ];

    const fakeDir = {
      name: 'MIGRATIONS',
      values: async function* () {
        for (const item of fakeEntries) yield item;
      },
    } as unknown as FileSystemDirectoryHandle;

    const list = await readDirectoryChildren(fakeDir);
    expect(list.map((e) => `${e.kind}:${e.name}`)).toEqual([
      'directory:docs',
      'file:README.md',
      'file:TEST.md',
    ]);
    expect(list[0].loaded).toBe(false);
  });

  it('updates lazy directory children immutably via updateDirectoryEntry', () => {
    const tree: FolderEntry[] = [
      {
        name: 'docs',
        path: 'docs',
        kind: 'directory',
        handle: {} as FileSystemDirectoryHandle,
        children: [],
        loaded: false,
      },
    ];

    const updated = updateDirectoryEntry(tree, 'docs', (item) => ({
      ...item,
      loaded: true,
      children: [
        {
          name: 'guide.md',
          path: 'docs/guide.md',
          kind: 'file',
          handle: {} as FileSystemFileHandle,
        },
      ],
    }));

    expect(updated[0].loaded).toBe(true);
    expect(updated[0].children?.map((c) => c.path)).toEqual(['docs/guide.md']);
  });

  it('falls back to read-only permission when readwrite is unavailable', async () => {
    idbStore.clear();
    const roDir = {
      name: 'DocsRO',
      queryPermission: vi.fn(async ({ mode }: { mode: string }) =>
        mode === 'read' ? 'granted' : 'prompt',
      ),
      requestPermission: vi.fn(async ({ mode }: { mode: string }) =>
        mode === 'read' ? 'granted' : 'denied',
      ),
    } as unknown as FileSystemDirectoryHandle;

    await saveDirectoryHandle(roDir);
    const loaded = await loadSavedDirectoryHandle();
    expect(loaded).toEqual({ handle: roDir, granted: true, readOnly: true });

    const ensured = await ensureDirectoryPermission(roDir);
    expect(ensured).toEqual({ granted: true, readOnly: true });
  });
});

describe('markdown-only filtering and PWA launchQueue coordination', () => {
  it('accepts only markdown extensions and rejects plain text files', () => {
    expect(isMarkdownFilename('README.md')).toBe(true);
    expect(isMarkdownFilename('guide.markdown')).toBe(true);
    expect(isMarkdownFilename('component.mdx')).toBe(true);
    expect(isMarkdownFilename('notes.MDOWN')).toBe(true);
    expect(isMarkdownFilename('notes.txt')).toBe(false);
    expect(isMarkdownFilename('README.TXT')).toBe(false);
    expect(isMarkdownFilename('document.pdf')).toBe(false);
  });

  it('skips .txt files in folder listings', async () => {
    const fakeDir = {
      name: 'Notes',
      values: async function* () {
        yield { kind: 'file', name: 'readme.md' };
        yield { kind: 'file', name: 'plain.txt' };
        yield { kind: 'file', name: 'chapter.markdown' };
      },
    } as unknown as FileSystemDirectoryHandle;

    const list = await readDirectoryChildren(fakeDir);
    expect(list.map((e) => e.name)).toEqual(['chapter.markdown', 'readme.md']);
  });

  it('buffers early launchQueue batches and ignores non-markdown files', async () => {
    type Consumer = (params: { files?: FileSystemFileHandle[] }) => void | Promise<void>;
    const captured: { consumer: Consumer | null } = { consumer: null };

    window.launchQueue = {
      setConsumer: vi.fn((cb: Consumer) => {
        captured.consumer = cb;
      }),
    };

    const mdHandle = {
      kind: 'file',
      name: 'opened-from-explorer.md',
      getFile: async () => new File(['# From Explorer'], 'opened-from-explorer.md', { type: 'text/markdown' }),
    } as unknown as FileSystemFileHandle;

    const txtHandle = {
      kind: 'file',
      name: 'ignored.txt',
      getFile: async () => new File(['plain text'], 'ignored.txt', { type: 'text/plain' }),
    } as unknown as FileSystemFileHandle;

    const received: Array<Array<{ title: string; content: string }>> = [];
    const unsubscribe = subscribeLaunchQueue((files) => {
      received.push(files.map((f) => ({ title: f.title, content: f.content })));
    });

    expect(captured.consumer).not.toBeNull();
    await captured.consumer!({ files: [txtHandle, mdHandle] });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toEqual([{ title: 'opened-from-explorer.md', content: '# From Explorer' }]);

    unsubscribe();
    delete window.launchQueue;
  });

  it('preserves OS-launched tabs when session hydration completes later', () => {
    const scratchpad: EditorTab = {
      id: 'scratchpad',
      title: 'Nota rápida',
      content: '# Demo',
      savedContent: '# Demo',
      isScratchpad: true,
    };

    const launched = mergeOpenedFilesIntoTabs(
      [scratchpad],
      [{ title: 'explorer.md', content: '# Opened from Windows', relativePath: 'explorer.md' }],
      () => 'tab-launched',
    );
    expect(launched.targetActiveId).toBe('tab-launched');

    const restoredSession: EditorTab[] = [
      scratchpad,
      {
        id: 'tab-old',
        title: 'old-note.md',
        content: '# Old',
        savedContent: '# Old',
        relativePath: 'old-note.md',
      },
    ];

    const merged = mergeRestoredSessionTabs(launched.tabs, restoredSession);
    expect(merged.map((t) => t.id)).toEqual(['scratchpad', 'tab-old', 'tab-launched']);

    // If the launched file matches one already in the restored session, reuse slot with fresh content
    const duplicateMap = new Map([['tab-launched', 'tab-old']]);
    const deduped = mergeRestoredSessionTabs(launched.tabs, restoredSession, duplicateMap);
    expect(deduped.map((t) => `${t.id}:${t.title}:${t.content}`)).toEqual([
      'scratchpad:Nota rápida:# Demo',
      'tab-launched:explorer.md:# Opened from Windows',
    ]);
  });
});
