import { describe, expect, it, vi } from 'vitest';

const idbStore = new Map<string, unknown>();
const idbWriteLog: Array<{ key: string; val: unknown }> = [];
let idbSetHook: ((key: string, val: unknown) => Promise<void>) | null = null;

vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => idbStore.get(key)),
  set: vi.fn(async (key: string, val: unknown) => {
    if (idbSetHook) {
      await idbSetHook(key, val);
    }
    idbWriteLog.push({ key, val });
    idbStore.set(key, val);
  }),
}));

import {
  buildVirtualDirectoryFromFiles,
  consumeExtensionIncomingMarkdown,
  createFileInFolder,
  ensureDirectoryPermission,
  isDirectoryWritable,
  isMarkdownFilename,
  loadSavedDirectoryHandle,
  loadSessionFromStorage,
  mergeOpenedFilesIntoTabs,
  mergeRestoredSessionTabs,
  normalizeDownloadFilename,
  normalizeViewMode,
  readDirectoryChildren,
  readDiskFileIfChanged,
  readFileFromHandle,
  saveDirectoryHandle,
  saveSessionToStorage,
  saveTabToDisk,
  subscribeLaunchQueue,
  updateDirectoryEntry,
  type EditorTab,
  type FolderEntry,
  type PersistedSession,
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

describe('loadSessionFromStorage & serialized saveSessionToStorage', () => {
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

  it('serializes concurrent saveSessionToStorage writes without interleaving SESSION_KEY and FILE_HANDLES_KEY', async () => {
    idbStore.clear();
    idbWriteLog.length = 0;

    let releaseFirstSessionSet!: () => void;
    const firstSessionGate = new Promise<void>((resolve) => {
      releaseFirstSessionSet = resolve;
    });

    let hookCalls = 0;
    idbSetHook = async (key: string) => {
      hookCalls += 1;
      // Pause right on the first call's SESSION_KEY write while second save is already queued
      if (hookCalls === 1 && key === 'prismamd.session.v1') {
        await firstSessionGate;
      }
    };

    const handleA = { kind: 'file', name: 'a.md' } as unknown as FileSystemFileHandle;
    const handleB = { kind: 'file', name: 'b.md' } as unknown as FileSystemFileHandle;

    const tabs1: EditorTab[] = [
      {
        id: 'scratchpad',
        title: 'Quick Note',
        content: '# Scratch',
        savedContent: '# Scratch',
        isScratchpad: true,
        fileHandle: handleA, // Should also be stripped for scratchpad
      },
      {
        id: 'tab-a',
        title: 'a.md',
        content: '# A1',
        savedContent: '# A1',
        fileHandle: handleA,
        diskLastModified: 1000,
      },
    ];

    const tabs2: EditorTab[] = [
      {
        id: 'tab-b',
        title: 'b.md',
        content: '# B2',
        savedContent: '# B2',
        fileHandle: handleB,
        diskLastModified: 2000,
      },
    ];

    const session1: PersistedSession = {
      tabs: [{ id: 'tab-a', title: 'a.md', content: '# A1', savedContent: '# A1', diskLastModified: 1000 }],
      activeTabId: 'tab-a',
      viewMode: 'split',
      theme: 'dark',
      explorerOpen: true,
      outlineOpen: false,
      scrollSync: true,
    };

    const session2: PersistedSession = {
      tabs: [{ id: 'tab-b', title: 'b.md', content: '# B2', savedContent: '# B2', diskLastModified: 2000 }],
      activeTabId: 'tab-b',
      viewMode: 'raw',
      theme: 'sepia',
      explorerOpen: false,
      outlineOpen: true,
      scrollSync: false,
    };

    const p1 = saveSessionToStorage(session1, tabs1);
    const p2 = saveSessionToStorage(session2, tabs2);

    // Let p2 enqueue before releasing p1
    await Promise.resolve();
    releaseFirstSessionSet();
    await Promise.all([p1, p2]);
    idbSetHook = null;

    expect(idbWriteLog.map((entry) => entry.key)).toEqual([
      'prismamd.session.v1',
      'prismamd.fileHandles.v1',
      'prismamd.session.v1',
      'prismamd.fileHandles.v1',
    ]);

    const { session, fileHandles } = await loadSessionFromStorage();
    expect(session?.activeTabId).toBe('tab-b');
    expect(session?.tabs[0]?.diskLastModified).toBe(2000);
    expect(Object.keys(fileHandles)).toEqual(['tab-b']);
    expect(fileHandles['tab-b']).toBe(handleB);
  });
});

describe('createFileInFolder validation and overwrite protection', () => {
  it('rejects empty, slash-containing, or dotfile names with INVALID_FILENAME', async () => {
    const dir = {
      getFileHandle: vi.fn(),
    } as unknown as FileSystemDirectoryHandle;

    await expect(createFileInFolder(dir, '')).rejects.toThrow('INVALID_FILENAME');
    await expect(createFileInFolder(dir, '   ')).rejects.toThrow('INVALID_FILENAME');
    await expect(createFileInFolder(dir, 'sub/note.md')).rejects.toThrow('INVALID_FILENAME');
    await expect(createFileInFolder(dir, 'sub\\note.md')).rejects.toThrow('INVALID_FILENAME');
    await expect(createFileInFolder(dir, '.hidden.md')).rejects.toThrow('INVALID_FILENAME');
    await expect(createFileInFolder(dir, '..')).rejects.toThrow('INVALID_FILENAME');
    expect(dir.getFileHandle).not.toHaveBeenCalled();
  });

  it('throws FILE_EXISTS:<name> without truncating or writing when target file already exists', async () => {
    const createWritable = vi.fn();
    const existingHandle = {
      kind: 'file',
      name: 'README.md',
      createWritable,
    } as unknown as FileSystemFileHandle;

    const getFileHandle = vi.fn(async (_name: string, opts?: { create?: boolean }) => {
      if (!opts?.create) {
        return existingHandle;
      }
      throw new Error('Should never be called with create: true when file exists');
    });

    const dir = { getFileHandle } as unknown as FileSystemDirectoryHandle;

    await expect(createFileInFolder(dir, 'README')).rejects.toThrow('FILE_EXISTS:README.md');
    expect(getFileHandle).toHaveBeenCalledTimes(1);
    expect(getFileHandle).toHaveBeenCalledWith('README.md', { create: false });
    expect(createWritable).not.toHaveBeenCalled();
  });

  it('creates new file and returns lastModified when { create: false } rejects with NotFoundError', async () => {
    let writtenData = '';
    const newHandle = {
      kind: 'file',
      name: 'new-note.md',
      createWritable: vi.fn(async () => ({
        write: vi.fn(async (chunk: string) => {
          writtenData = chunk;
        }),
        close: vi.fn(async () => undefined),
      })),
      getFile: vi.fn(async () => new File([writtenData], 'new-note.md', { lastModified: 1731700000123 })),
    } as unknown as FileSystemFileHandle;

    const getFileHandle = vi.fn(async (_name: string, opts?: { create?: boolean }) => {
      if (!opts?.create) {
        const err = new Error('Not found');
        err.name = 'NotFoundError';
        throw err;
      }
      return newHandle;
    });

    const dir = { getFileHandle } as unknown as FileSystemDirectoryHandle;
    const res = await createFileInFolder(dir, undefined, 'new-note.md');

    expect(res.title).toBe('new-note.md');
    expect(res.content).toBe('# new-note\n\n');
    expect(res.lastModified).toBe(1731700000123);
    expect(writtenData).toBe('# new-note\n\n');
    expect(getFileHandle).toHaveBeenNthCalledWith(1, 'new-note.md', { create: false });
    expect(getFileHandle).toHaveBeenNthCalledWith(2, 'new-note.md', { create: true });
  });
});

describe('readDiskFileIfChanged, readFileFromHandle & OS read-only Save-As fallback', () => {
  it('returns changed: false when lastModified matches knownLastModified, and changed: true when modified', async () => {
    let currentContent = '# Initial';
    let currentMtime = 5000;

    const handle = {
      kind: 'file',
      name: 'doc.md',
      queryPermission: vi.fn(async () => 'granted' as PermissionState),
      getFile: vi.fn(async () => new File([currentContent], 'doc.md', { lastModified: currentMtime })),
    } as unknown as FileSystemFileHandle;

    const initialRead = await readFileFromHandle(handle, 'doc.md');
    expect(initialRead).toEqual({
      title: 'doc.md',
      content: '# Initial',
      fileHandle: handle,
      relativePath: 'doc.md',
      lastModified: 5000,
    });

    const unchanged = await readDiskFileIfChanged(handle, 5000);
    expect(unchanged).toEqual({ changed: false, lastModified: 5000 });

    currentContent = '# Externally Updated';
    currentMtime = 6500;
    const changed = await readDiskFileIfChanged(handle, 5000);
    expect(changed).toEqual({
      changed: true,
      content: '# Externally Updated',
      lastModified: 6500,
    });
  });

  it('catches permission / SecurityError rejections cleanly in readDiskFileIfChanged', async () => {
    const throwingHandle = {
      kind: 'file',
      name: 'locked.md',
      queryPermission: vi.fn(async () => 'prompt' as PermissionState),
      requestPermission: vi.fn(async () => {
        const err = new Error('User activation is required');
        err.name = 'SecurityError';
        throw err;
      }),
      getFile: vi.fn(),
    } as unknown as FileSystemFileHandle;

    await expect(readDiskFileIfChanged(throwingHandle, 1000)).resolves.toEqual({ changed: false });
    expect(throwingHandle.getFile).not.toHaveBeenCalled();
  });

  it('falls back to showSaveFilePicker with usedFallbackSaveAs: true when OS file is read-only', async () => {
    const readOnlyHandle = {
      kind: 'file',
      name: 'readonly.md',
      queryPermission: vi.fn(async () => 'granted' as PermissionState),
      createWritable: vi.fn(async () => {
        const err = new Error('OS file is read-only');
        err.name = 'NoModificationAllowedError';
        throw err;
      }),
    } as unknown as FileSystemFileHandle;

    let savedCopyText = '';
    const copyHandle = {
      kind: 'file',
      name: 'readonly-copy.md',
      createWritable: vi.fn(async () => ({
        write: vi.fn(async (txt: string) => {
          savedCopyText = txt;
        }),
        close: vi.fn(async () => undefined),
      })),
      getFile: vi.fn(async () => new File([savedCopyText], 'readonly-copy.md', { lastModified: 9999 })),
    } as unknown as FileSystemFileHandle;

    const origSavePicker = window.showSaveFilePicker;
    window.showSaveFilePicker = vi.fn(async () => copyHandle);

    try {
      const tab: EditorTab = {
        id: 'tab-ro',
        title: 'readonly.md',
        content: '# Edited Locally',
        savedContent: '# Original',
        fileHandle: readOnlyHandle,
      };

      const res = await saveTabToDisk(tab, false, 'quick-note.md');
      expect(res).toEqual({
        title: 'readonly-copy.md',
        fileHandle: copyHandle,
        lastModified: 9999,
        usedFallbackSaveAs: true,
      });
      expect(savedCopyText).toBe('# Edited Locally');
      expect(window.showSaveFilePicker).toHaveBeenCalledWith(
        expect.objectContaining({ suggestedName: 'readonly.md' }),
      );
    } finally {
      window.showSaveFilePicker = origSavePicker;
    }
  });

  it('preserves .MD, .mdx, and .mdown extensions without appending duplicate .md', () => {
    expect(normalizeDownloadFilename('README.MD')).toBe('README.MD');
    expect(normalizeDownloadFilename('page.mdx')).toBe('page.mdx');
    expect(normalizeDownloadFilename('notes.mdown')).toBe('notes.mdown');
    expect(normalizeDownloadFilename('guide.markdown')).toBe('guide.markdown');
    expect(normalizeDownloadFilename('untitled')).toBe('untitled.md');
  });
});

describe('consumeExtensionIncomingMarkdown Side Panel guard', () => {
  it('ignores and preserves prismamd_incoming_md when isSidePanel=true and targetSurface="tab"', async () => {
    const storageMap: Record<string, unknown> = {
      prismamd_incoming_md: {
        filename: 'viewer-doc.md',
        content: '# From Viewer',
        sourceUrl: 'https://example.com/viewer-doc.md',
        targetSurface: 'tab',
      },
    };

    const removeMock = vi.fn(async (key: string) => {
      delete storageMap[key];
    });

    const prevChrome = (globalThis as { chrome?: unknown }).chrome;
    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storageMap[key] })),
          remove: removeMock,
        },
      },
    };

    try {
      // Side Panel must NOT consume or delete Full-Tab payload
      const sidePanelResult = await consumeExtensionIncomingMarkdown(true);
      expect(sidePanelResult).toBeNull();
      expect(removeMock).not.toHaveBeenCalled();
      expect(storageMap.prismamd_incoming_md).toBeDefined();

      // Full-Tab consumes and deletes the payload cleanly
      const fullTabResult = await consumeExtensionIncomingMarkdown(false);
      expect(fullTabResult).toEqual({
        filename: 'viewer-doc.md',
        content: '# From Viewer',
        sourceUrl: 'https://example.com/viewer-doc.md',
        targetSurface: 'tab',
      });
      expect(removeMock).toHaveBeenCalledWith('prismamd_incoming_md');
      expect(storageMap.prismamd_incoming_md).toBeUndefined();
    } finally {
      (globalThis as { chrome?: unknown }).chrome = prevChrome;
    }
  });
});

describe('readDirectoryChildren, read-only folder support & webkitdirectory virtual tree', () => {
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

  it('builds a read-only virtual directory tree from webkitdirectory File blobs', async () => {
    const f1 = new File(['# Root Readme'], 'README.md', { type: 'text/markdown', lastModified: 1111 });
    Object.defineProperty(f1, 'webkitRelativePath', { value: 'Vault/README.md' });

    const f2 = new File(['# Nested Guide'], 'guide.mdx', { type: 'text/markdown', lastModified: 2222 });
    Object.defineProperty(f2, 'webkitRelativePath', { value: 'Vault/docs/guide.mdx' });

    const fIgnored = new File(['ignored'], 'pkg.md', { type: 'text/markdown' });
    Object.defineProperty(fIgnored, 'webkitRelativePath', { value: 'Vault/node_modules/pkg.md' });

    const fTxt = new File(['plain'], 'notes.txt', { type: 'text/plain' });
    Object.defineProperty(fTxt, 'webkitRelativePath', { value: 'Vault/notes.txt' });

    const virtualRoot = buildVirtualDirectoryFromFiles([f1, f2, fIgnored, fTxt]);
    expect(virtualRoot).not.toBeNull();
    expect(virtualRoot!.name).toBe('Vault');
    expect(virtualRoot!.readOnly).toBe(true);
    expect(await isDirectoryWritable(virtualRoot!)).toBe(false);

    const topEntries = await readDirectoryChildren(virtualRoot!);
    expect(topEntries.map((e) => `${e.kind}:${e.path}:${Boolean(e.readOnly)}`)).toEqual([
      'directory:docs:true',
      'file:README.md:true',
    ]);

    const subEntries = await readDirectoryChildren(
      topEntries[0].handle as FileSystemDirectoryHandle,
      topEntries[0].path,
    );
    expect(subEntries.map((e) => e.path)).toEqual(['docs/guide.mdx']);

    const readSub = await readFileFromHandle(
      subEntries[0].handle as FileSystemFileHandle,
      subEntries[0].path,
    );
    expect(readSub.content).toBe('# Nested Guide');
    expect(readSub.lastModified).toBe(2222);
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
      [{ title: 'explorer.md', content: '# Opened from Windows', relativePath: 'explorer.md', lastModified: 4321 }],
      () => 'tab-launched',
    );
    expect(launched.targetActiveId).toBe('tab-launched');
    expect(launched.tabs[1]?.diskLastModified).toBe(4321);

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
