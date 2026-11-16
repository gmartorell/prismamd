import { get as idbGet, set as idbSet } from 'idb-keyval';
import type { ThemeMode } from '../renderers/mermaidRenderer';

export type ViewMode = 'raw' | 'split' | 'preview';

export function normalizeViewMode(value: unknown, fallback: ViewMode = 'split'): ViewMode {
  if (value === 'human' || value === 'preview') return 'preview';
  if (value === 'raw' || value === 'split') return value;
  return fallback;
}

export interface EditorTab {
  id: string;
  title: string;
  content: string;
  savedContent: string;
  isScratchpad?: boolean;
  fileHandle?: FileSystemFileHandle;
  relativePath?: string;
  diskLastModified?: number;
}

export interface FolderEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  handle: FileSystemFileHandle | FileSystemDirectoryHandle;
  readOnly?: boolean;
  children?: FolderEntry[];
  loaded?: boolean;
  loading?: boolean;
}

export interface PersistedTabSnapshot {
  id: string;
  title: string;
  content: string;
  savedContent: string;
  isScratchpad?: boolean;
  relativePath?: string;
  diskLastModified?: number;
}

export type TabSessionSnapshot = PersistedTabSnapshot;

export interface PersistedSession {
  tabs: PersistedTabSnapshot[];
  activeTabId: string;
  viewMode: ViewMode;
  theme: ThemeMode;
  explorerOpen: boolean;
  outlineOpen: boolean;
  scrollSync: boolean;
}

export interface SaveTabResult {
  title: string;
  fileHandle?: FileSystemFileHandle;
  lastModified: number;
  usedFallbackSaveAs?: boolean;
}

export interface DiskFileCheckResult {
  changed: boolean;
  content?: string;
  lastModified?: number;
}

export interface DirectoryEntryNode {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  readOnly: true;
  file?: File;
  children?: Map<string, DirectoryEntryNode>;
}

export interface VirtualDirectoryHandle extends FileSystemDirectoryHandle {
  readonly readOnly: true;
  readonly isVirtual: true;
}

interface PermissionDescriptorLike {
  mode?: 'read' | 'readwrite';
}

interface HandleWithPermission {
  queryPermission?: (desc?: PermissionDescriptorLike) => Promise<PermissionState>;
  requestPermission?: (desc?: PermissionDescriptorLike) => Promise<PermissionState>;
}

interface LaunchParamsLike {
  files?: Array<{ getFile: () => Promise<File> } & FileSystemFileHandle>;
}

declare global {
  interface Window {
    showOpenFilePicker?: (options?: {
      multiple?: boolean;
      types?: Array<{ description?: string; accept: Record<string, string[]> }>;
    }) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: Array<{ description?: string; accept: Record<string, string[]> }>;
    }) => Promise<FileSystemFileHandle>;
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
    launchQueue?: {
      setConsumer: (cb: (launchParams: LaunchParamsLike) => void | Promise<void>) => void;
    };
  }
}

const SESSION_KEY = 'prismamd.session.v1';
const DIR_HANDLE_KEY = 'prismamd.dirHandle.v1';
const FILE_HANDLES_KEY = 'prismamd.fileHandles.v1';
const VIEWER_INCOMING_KEY = 'prismamd_incoming_md';
const SCRATCHPAD_APPEND_KEY = 'prismamd_scratchpad_append';

const MARKDOWN_FILE_RE = /\.(md|markdown|mdx|mdown)$/i;

const READONLY_WRITE_ERRORS = new Set([
  'NotAllowedError',
  'InvalidModificationError',
  'NoModificationAllowedError',
  'SecurityError',
]);

let sessionSaveQueue: Promise<void> = Promise.resolve();

export function isMarkdownFilename(name: string): boolean {
  return MARKDOWN_FILE_RE.test(name);
}

export function createTabId(): string {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function isVirtualDirectoryHandle(
  handle: FileSystemDirectoryHandle | null | undefined,
): handle is VirtualDirectoryHandle {
  return Boolean(handle && (handle as Partial<VirtualDirectoryHandle>).isVirtual === true);
}

export function saveSessionToStorage(session: PersistedSession, tabs: EditorTab[]): Promise<void> {
  const sessionSnapshot: PersistedSession = {
    ...session,
    tabs: session.tabs.map((tb) => ({ ...tb })),
  };
  const tabsSnapshot = tabs.slice();

  const run = sessionSaveQueue.then(async () => {
    try {
      const handlesObj: Record<string, FileSystemFileHandle> = {};
      for (const tab of tabsSnapshot) {
        if (tab.fileHandle && !tab.isScratchpad) {
          handlesObj[tab.id] = tab.fileHandle;
        }
      }
      await idbSet(SESSION_KEY, sessionSnapshot);
      await idbSet(FILE_HANDLES_KEY, handlesObj);
    } catch {
      // Fallback quietly if IndexedDB is unavailable
    }
  });

  sessionSaveQueue = run.catch(() => undefined);
  return run;
}

export async function loadSessionFromStorage(): Promise<{
  session: PersistedSession | null;
  fileHandles: Record<string, FileSystemFileHandle>;
}> {
  try {
    const [session, fileHandles] = await Promise.all([
      idbGet<PersistedSession>(SESSION_KEY),
      idbGet<Record<string, FileSystemFileHandle>>(FILE_HANDLES_KEY),
    ]);
    return {
      session: session
        ? {
            ...session,
            viewMode: normalizeViewMode(session.viewMode),
          }
        : null,
      fileHandles: fileHandles ?? {},
    };
  } catch {
    return { session: null, fileHandles: {} };
  }
}

export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle | null): Promise<void> {
  if (handle && isVirtualDirectoryHandle(handle)) {
    return;
  }
  try {
    await idbSet(DIR_HANDLE_KEY, handle);
  } catch {
    // Ignore IDB errors
  }
}

export async function isDirectoryWritable(handle: FileSystemDirectoryHandle): Promise<boolean> {
  if (isVirtualDirectoryHandle(handle)) {
    return false;
  }
  try {
    const permHandle = handle as unknown as HandleWithPermission;
    if (!permHandle.queryPermission) return true;
    return (await permHandle.queryPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

export async function loadSavedDirectoryHandle(): Promise<{
  handle: FileSystemDirectoryHandle | null;
  granted: boolean;
  readOnly: boolean;
}> {
  try {
    const handle = await idbGet<FileSystemDirectoryHandle | null>(DIR_HANDLE_KEY);
    if (!handle) return { handle: null, granted: false, readOnly: false };
    const permHandle = handle as unknown as HandleWithPermission;
    if (!permHandle.queryPermission) {
      return { handle, granted: true, readOnly: false };
    }
    const rw = await permHandle.queryPermission({ mode: 'readwrite' });
    if (rw === 'granted') {
      return { handle, granted: true, readOnly: false };
    }
    const ro = await permHandle.queryPermission({ mode: 'read' });
    if (ro === 'granted') {
      return { handle, granted: true, readOnly: true };
    }
    return { handle, granted: false, readOnly: false };
  } catch {
    return { handle: null, granted: false, readOnly: false };
  }
}

export async function ensureDirectoryPermission(
  handle: FileSystemDirectoryHandle,
): Promise<{ granted: boolean; readOnly: boolean }> {
  if (isVirtualDirectoryHandle(handle)) {
    return { granted: true, readOnly: true };
  }
  const permHandle = handle as unknown as HandleWithPermission;
  if (!permHandle.requestPermission) return { granted: true, readOnly: false };
  try {
    const rw = await permHandle.requestPermission({ mode: 'readwrite' });
    if (rw === 'granted') return { granted: true, readOnly: false };
  } catch {
    // Fall back to read-only permission below
  }
  try {
    const ro = await permHandle.requestPermission({ mode: 'read' });
    if (ro === 'granted') return { granted: true, readOnly: true };
  } catch {
    // Ignore
  }
  return { granted: false, readOnly: false };
}

export async function ensureFilePermission(
  handle: FileSystemFileHandle,
  mode: 'read' | 'readwrite' = 'readwrite',
): Promise<boolean> {
  const permHandle = handle as unknown as HandleWithPermission;
  try {
    if (permHandle.queryPermission) {
      const current = await permHandle.queryPermission({ mode });
      if (current === 'granted') return true;
      if (current === 'denied') return false;
    }
  } catch {
    // Fall through to requestPermission if available
  }
  try {
    if (permHandle.requestPermission) {
      const requested = await permHandle.requestPermission({ mode });
      return requested === 'granted';
    }
  } catch {
    return false;
  }
  return !permHandle.queryPermission && !permHandle.requestPermission;
}

async function readHandleLastModified(handle: FileSystemFileHandle): Promise<number> {
  if (typeof handle.getFile === 'function') {
    try {
      const file = await handle.getFile();
      if (typeof file.lastModified === 'number') {
        return file.lastModified;
      }
    } catch {
      // Fall back to current timestamp if handle mock lacks getFile
    }
  }
  return Date.now();
}

export async function readFileFromHandle(
  fileHandle: FileSystemFileHandle,
  relativePath?: string,
): Promise<{
  title: string;
  content: string;
  fileHandle: FileSystemFileHandle;
  relativePath?: string;
  lastModified: number;
}> {
  const file = await fileHandle.getFile();
  const content = await file.text();
  return {
    title: file.name,
    content,
    fileHandle,
    relativePath,
    lastModified: file.lastModified,
  };
}

export async function readDiskFileIfChanged(
  handle?: FileSystemFileHandle,
  knownLastModified?: number,
): Promise<DiskFileCheckResult> {
  if (!handle || typeof handle.getFile !== 'function') {
    return { changed: false };
  }
  try {
    const permitted = await ensureFilePermission(handle, 'read');
    if (!permitted) {
      return { changed: false };
    }
    const file = await handle.getFile();
    const lastModified = file.lastModified;
    if (knownLastModified !== undefined && lastModified === knownLastModified) {
      return { changed: false, lastModified };
    }
    const content = await file.text();
    return {
      changed: true,
      content,
      lastModified,
    };
  } catch {
    return { changed: false };
  }
}

export async function openMarkdownFilesFromPicker(): Promise<LoadedMarkdownFile[]> {
  if (typeof window.showOpenFilePicker === 'function') {
    const handles = await window.showOpenFilePicker({
      multiple: true,
      types: [
        {
          description: 'Markdown',
          accept: {
            'text/markdown': ['.md', '.markdown', '.mdx', '.mdown'],
          },
        },
      ],
    });
    const results: LoadedMarkdownFile[] = [];
    for (const handle of handles) {
      const file = await handle.getFile();
      if (!isMarkdownFilename(file.name)) continue;
      results.push({
        title: file.name,
        content: await file.text(),
        fileHandle: handle,
        lastModified: file.lastModified,
      });
    }
    return results;
  }

  return await new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.md,.markdown,.mdx,.mdown,text/markdown';
    input.addEventListener('cancel', () => resolve([]));
    input.onchange = async () => {
      const files = Array.from(input.files ?? []).filter((f) => isMarkdownFilename(f.name));
      const loaded = await Promise.all(
        files.map(async (f) => ({
          title: f.name,
          content: await f.text(),
          lastModified: f.lastModified,
        })),
      );
      resolve(loaded);
    };
    input.click();
  });
}

export async function openMarkdownFileFromPicker(): Promise<LoadedMarkdownFile | null> {
  const files = await openMarkdownFilesFromPicker();
  return files[0] ?? null;
}

export function normalizeDownloadFilename(filename: string): string {
  return MARKDOWN_FILE_RE.test(filename) ? filename : `${filename}.md`;
}

function triggerBrowserDownload(filename: string, content: string, mime = 'text/markdown;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = normalizeDownloadFilename(filename);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function saveTabToDisk(
  tab: EditorTab,
  forceSaveAs = false,
  defaultName = 'nota-rapida.md',
): Promise<SaveTabResult> {
  let fellBackFromReadOnly = false;

  if (!forceSaveAs && tab.fileHandle) {
    if (typeof tab.fileHandle.createWritable !== 'function') {
      fellBackFromReadOnly = true;
    } else {
      const ok = await ensureFilePermission(tab.fileHandle, 'readwrite');
      if (ok) {
        try {
          const writable = await tab.fileHandle.createWritable();
          await writable.write(tab.content);
          await writable.close();
          const lastModified = await readHandleLastModified(tab.fileHandle);
          return {
            title: tab.fileHandle.name,
            fileHandle: tab.fileHandle,
            lastModified,
          };
        } catch (err) {
          const errName = (err as { name?: string })?.name ?? '';
          if (READONLY_WRITE_ERRORS.has(errName)) {
            fellBackFromReadOnly = true;
          } else {
            throw err;
          }
        }
      } else {
        fellBackFromReadOnly = true;
      }
    }
  }

  const suggestedName = tab.isScratchpad ? defaultName : tab.title || defaultName;

  if (typeof window.showSaveFilePicker === 'function') {
    const handle = await window.showSaveFilePicker({
      suggestedName,
      types: [
        {
          description: 'Markdown',
          accept: { 'text/markdown': ['.md', '.markdown', '.mdx', '.mdown'] },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(tab.content);
    await writable.close();
    const lastModified = await readHandleLastModified(handle);
    return {
      title: handle.name,
      fileHandle: handle,
      lastModified,
      ...(fellBackFromReadOnly ? { usedFallbackSaveAs: true } : {}),
    };
  }

  const downloadName = normalizeDownloadFilename(suggestedName);
  triggerBrowserDownload(downloadName, tab.content);
  return {
    title: downloadName,
    fileHandle: undefined,
    lastModified: Date.now(),
    ...(fellBackFromReadOnly ? { usedFallbackSaveAs: true } : {}),
  };
}

const IGNORED_DIR_NAMES = new Set([
  'node_modules',
  '__pycache__',
  'venv',
  '.venv',
  'env',
  'envs',
  'dist',
  'dist-pwa',
  'dist-extension',
  'build',
  'target',
  'coverage',
]);

export function shouldSkipDirectoryEntry(name: string): boolean {
  return name.startsWith('.') || IGNORED_DIR_NAMES.has(name);
}

function createVirtualFileHandle(node: DirectoryEntryNode): FileSystemFileHandle {
  const file = node.file!;
  const handle = {
    kind: 'file' as const,
    name: node.name,
    getFile: async () => file,
    queryPermission: async (desc?: PermissionDescriptorLike): Promise<PermissionState> =>
      desc?.mode === 'readwrite' ? 'denied' : 'granted',
    requestPermission: async (desc?: PermissionDescriptorLike): Promise<PermissionState> =>
      desc?.mode === 'readwrite' ? 'denied' : 'granted',
    isSameEntry: async (other: FileSystemHandle) => other === (handle as unknown as FileSystemHandle),
  };
  return handle as unknown as FileSystemFileHandle;
}

function createVirtualDirectoryHandleFromNode(node: DirectoryEntryNode): VirtualDirectoryHandle {
  const handle = {
    kind: 'directory' as const,
    name: node.name,
    readOnly: true as const,
    isVirtual: true as const,
    queryPermission: async (desc?: PermissionDescriptorLike): Promise<PermissionState> =>
      desc?.mode === 'readwrite' ? 'denied' : 'granted',
    requestPermission: async (desc?: PermissionDescriptorLike): Promise<PermissionState> =>
      desc?.mode === 'readwrite' ? 'denied' : 'granted',
    isSameEntry: async (other: FileSystemHandle) => other === (handle as unknown as FileSystemHandle),
    getFileHandle: async (
      name: string,
      options?: { create?: boolean },
    ): Promise<FileSystemFileHandle> => {
      if (options?.create) {
        const err = new Error('Read-only virtual directory');
        err.name = 'NotAllowedError';
        throw err;
      }
      const child = node.children?.get(name);
      if (!child || child.kind !== 'file') {
        const err = new Error(`File not found: ${name}`);
        err.name = 'NotFoundError';
        throw err;
      }
      return createVirtualFileHandle(child);
    },
    getDirectoryHandle: async (
      name: string,
      options?: { create?: boolean },
    ): Promise<FileSystemDirectoryHandle> => {
      if (options?.create) {
        const err = new Error('Read-only virtual directory');
        err.name = 'NotAllowedError';
        throw err;
      }
      const child = node.children?.get(name);
      if (!child || child.kind !== 'directory') {
        const err = new Error(`Directory not found: ${name}`);
        err.name = 'NotFoundError';
        throw err;
      }
      return createVirtualDirectoryHandleFromNode(child);
    },
    values: async function* () {
      if (!node.children) return;
      for (const child of node.children.values()) {
        if (child.kind === 'directory') {
          yield createVirtualDirectoryHandleFromNode(child);
        } else if (child.file) {
          yield createVirtualFileHandle(child);
        }
      }
    },
  };
  return handle as unknown as VirtualDirectoryHandle;
}

export function buildVirtualDirectoryFromFiles(
  files: Iterable<File>,
  fallbackName = 'Folder',
): VirtualDirectoryHandle | null {
  const fileList = Array.from(files);
  if (fileList.length === 0) return null;

  let rootName = fallbackName;
  for (const file of fileList) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
    const firstPart = rel.split('/').filter(Boolean)[0];
    if (firstPart) {
      rootName = firstPart;
      break;
    }
  }

  const rootNode: DirectoryEntryNode = {
    name: rootName,
    path: '',
    kind: 'directory',
    readOnly: true,
    children: new Map(),
  };

  for (const file of fileList) {
    const rawRel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const parts = rawRel.split('/').filter(Boolean);
    const relativeSegments = parts.length > 1 && parts[0] === rootName ? parts.slice(1) : parts;
    if (relativeSegments.length === 0) continue;

    let currentDir = rootNode;
    let skipEntry = false;
    for (let i = 0; i < relativeSegments.length - 1; i++) {
      const seg = relativeSegments[i];
      if (shouldSkipDirectoryEntry(seg)) {
        skipEntry = true;
        break;
      }
      const nextPath = currentDir.path ? `${currentDir.path}/${seg}` : seg;
      let sub = currentDir.children!.get(seg);
      if (!sub) {
        sub = {
          name: seg,
          path: nextPath,
          kind: 'directory',
          readOnly: true,
          children: new Map(),
        };
        currentDir.children!.set(seg, sub);
      }
      currentDir = sub;
    }
    if (skipEntry) continue;

    const fileName = relativeSegments[relativeSegments.length - 1];
    if (shouldSkipDirectoryEntry(fileName) || !isMarkdownFilename(fileName)) continue;

    const filePath = currentDir.path ? `${currentDir.path}/${fileName}` : fileName;
    currentDir.children!.set(fileName, {
      name: fileName,
      path: filePath,
      kind: 'file',
      readOnly: true,
      file,
    });
  }

  return createVirtualDirectoryHandleFromNode(rootNode);
}

export async function openFolderPicker(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof window.showDirectoryPicker === 'function') {
    try {
      return await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') {
        throw err;
      }
      return await window.showDirectoryPicker({ mode: 'read' });
    }
  }

  if (typeof document === 'undefined') {
    return null;
  }

  return await new Promise<FileSystemDirectoryHandle | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.md,.markdown,.mdx,.mdown';
    input.setAttribute('webkitdirectory', '');
    (input as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = true;
    input.addEventListener('cancel', () => resolve(null));
    input.onchange = () => {
      const handle = buildVirtualDirectoryFromFiles(input.files ?? []);
      resolve(handle);
    };
    input.click();
  });
}

/**
 * Reads direct children (one level) of a directory tolerating broken symlinks
 * or unreadable individual entries without aborting the entire listing.
 */
export async function readDirectoryChildren(
  dirHandle: FileSystemDirectoryHandle,
  basePath = '',
): Promise<FolderEntry[]> {
  const entries: FolderEntry[] = [];
  const isVirtualRo = isVirtualDirectoryHandle(dirHandle);
  const rawValues = (dirHandle as unknown as {
    values: () => AsyncIterable<FileSystemFileHandle | FileSystemDirectoryHandle>;
  }).values();
  const iterator = rawValues[Symbol.asyncIterator]();

  let sawAny = false;
  while (true) {
    let step: IteratorResult<FileSystemFileHandle | FileSystemDirectoryHandle>;
    try {
      step = await iterator.next();
    } catch (err) {
      if (!sawAny) throw err;
      break;
    }
    if (step.done) break;
    sawAny = true;

    const handle = step.value;
    try {
      const name = handle.name;
      if (shouldSkipDirectoryEntry(name)) continue;
      const entryPath = basePath ? `${basePath}/${name}` : name;

      if (handle.kind === 'directory') {
        entries.push({
          name,
          path: entryPath,
          kind: 'directory',
          handle,
          ...(isVirtualRo ? { readOnly: true } : {}),
          children: [],
          loaded: false,
          loading: false,
        });
      } else if (handle.kind === 'file' && isMarkdownFilename(name)) {
        entries.push({
          name,
          path: entryPath,
          kind: 'file',
          handle,
          ...(isVirtualRo ? { readOnly: true } : {}),
        });
      }
    } catch {
      // Skip individual unreadable entries (e.g. broken symlinks)
    }
  }

  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return entries;
}

export function updateDirectoryEntry(
  entries: FolderEntry[],
  targetPath: string,
  updater: (entry: FolderEntry) => FolderEntry,
): FolderEntry[] {
  let changed = false;
  const next = entries.map((entry) => {
    if (entry.path === targetPath) {
      changed = true;
      return updater(entry);
    }
    if (entry.kind === 'directory' && entry.children && targetPath.startsWith(`${entry.path}/`)) {
      const updatedChildren = updateDirectoryEntry(entry.children, targetPath, updater);
      if (updatedChildren !== entry.children) {
        changed = true;
        return { ...entry, children: updatedChildren };
      }
    }
    return entry;
  });
  return changed ? next : entries;
}

export async function createFileInFolder(
  dirHandle: FileSystemDirectoryHandle,
  rawName?: string,
  defaultBaseName = 'nueva-nota.md',
): Promise<{
  title: string;
  content: string;
  fileHandle: FileSystemFileHandle;
  relativePath: string;
  lastModified: number;
}> {
  const candidate = rawName === undefined ? defaultBaseName.trim() : rawName.trim();
  if (!candidate || /[/\\]/.test(candidate) || candidate.startsWith('.')) {
    throw new Error('INVALID_FILENAME');
  }

  const finalName = isMarkdownFilename(candidate) ? candidate : `${candidate}.md`;

  let fileExists = false;
  try {
    await dirHandle.getFileHandle(finalName, { create: false });
    fileExists = true;
  } catch (err) {
    const errName = (err as { name?: string })?.name;
    if (errName !== 'NotFoundError') {
      throw err;
    }
  }

  if (fileExists) {
    throw new Error(`FILE_EXISTS:${finalName}`);
  }

  const fileHandle = await dirHandle.getFileHandle(finalName, { create: true });
  const initialContent = `# ${finalName.replace(/\.[^.]+$/, '')}\n\n`;
  const writable = await fileHandle.createWritable();
  await writable.write(initialContent);
  await writable.close();
  const lastModified = await readHandleLastModified(fileHandle);

  return {
    title: finalName,
    content: initialContent,
    fileHandle,
    relativePath: finalName,
    lastModified,
  };
}

export interface IncomingExtensionPayload {
  filename: string;
  content: string;
  sourceUrl?: string;
  targetSurface?: 'tab' | 'sidepanel' | 'any';
}

export async function consumeExtensionIncomingMarkdown(
  isSidePanel = false,
): Promise<IncomingExtensionPayload | null> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const data = await chrome.storage.local.get(VIEWER_INCOMING_KEY);
      const payload = data[VIEWER_INCOMING_KEY] as IncomingExtensionPayload | undefined;
      if (payload && typeof payload.content === 'string') {
        if (isSidePanel && payload.targetSurface === 'tab') {
          return null;
        }
        await chrome.storage.local.remove(VIEWER_INCOMING_KEY);
        return payload;
      }
    }
  } catch {
    // Not in extension context
  }
  return null;
}

export const consumeExtensionIncomingFile = consumeExtensionIncomingMarkdown;

export async function consumePendingScratchpadAppend(): Promise<string | null> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const data = await chrome.storage.local.get(SCRATCHPAD_APPEND_KEY);
      const text = data[SCRATCHPAD_APPEND_KEY] as string | undefined;
      if (text && text.trim().length > 0) {
        await chrome.storage.local.remove(SCRATCHPAD_APPEND_KEY);
        return text;
      }
    }
  } catch {
    // Ignore outside extension
  }
  return null;
}

export interface LoadedMarkdownFile {
  title: string;
  content: string;
  fileHandle?: FileSystemFileHandle;
  relativePath?: string;
  matchedTabId?: string;
  lastModified?: number;
}

export async function isSameFileHandle(
  a?: FileSystemFileHandle,
  b?: FileSystemFileHandle,
): Promise<boolean> {
  if (!a || !b) return false;
  if (a === b) return true;
  if (typeof a.isSameEntry === 'function') {
    try {
      return await a.isSameEntry(b);
    } catch {
      return false;
    }
  }
  return false;
}

export function mergeOpenedFilesIntoTabs(
  currentTabs: EditorTab[],
  incoming: LoadedMarkdownFile[],
  makeTabId: () => string = createTabId,
): { tabs: EditorTab[]; targetActiveId: string } {
  const next = [...currentTabs];
  let targetActiveId = '';

  for (const item of incoming) {
    const existingIndex = next.findIndex(
      (tab) =>
        !tab.isScratchpad &&
        ((item.matchedTabId && tab.id === item.matchedTabId) ||
          (item.relativePath && tab.relativePath === item.relativePath)),
    );

    if (existingIndex >= 0) {
      const existing = next[existingIndex];
      const isDirty = existing.content !== existing.savedContent;
      next[existingIndex] = {
        ...existing,
        title: item.title,
        content: isDirty ? existing.content : item.content,
        savedContent: item.content,
        fileHandle: item.fileHandle ?? existing.fileHandle,
        relativePath: item.relativePath ?? existing.relativePath,
        diskLastModified: item.lastModified ?? existing.diskLastModified,
      };
      targetActiveId = existing.id;
      continue;
    }

    const id = makeTabId();
    next.push({
      id,
      title: item.title,
      content: item.content,
      savedContent: item.content,
      fileHandle: item.fileHandle,
      relativePath: item.relativePath,
      diskLastModified: item.lastModified,
    });
    targetActiveId = id;
  }

  return { tabs: next, targetActiveId };
}

export function mergeRestoredSessionTabs(
  currentTabs: EditorTab[],
  restoredTabs: EditorTab[],
  duplicateBootTabIds: ReadonlyMap<string, string> = new Map(),
): EditorTab[] {
  const bootNonScratchpad = currentTabs.filter((tb) => !tb.isScratchpad);
  if (bootNonScratchpad.length === 0) {
    return restoredTabs;
  }

  const merged = restoredTabs.map((restoredTab) => {
    const matchingBoot = bootNonScratchpad.find(
      (bootTab) =>
        duplicateBootTabIds.get(bootTab.id) === restoredTab.id ||
        (bootTab.relativePath && restoredTab.relativePath === bootTab.relativePath),
    );
    return matchingBoot ?? restoredTab;
  });

  for (const bootTab of bootNonScratchpad) {
    const alreadyMerged = merged.some(
      (tab) =>
        tab.id === bootTab.id ||
        duplicateBootTabIds.get(bootTab.id) === tab.id ||
        (bootTab.relativePath && tab.relativePath === bootTab.relativePath),
    );
    if (!alreadyMerged) {
      merged.push(bootTab);
    }
  }

  return merged;
}

type LaunchConsumerFn = (cb: (launchParams: LaunchParamsLike) => void | Promise<void>) => void;

let registeredSetConsumer: LaunchConsumerFn | null = null;
let pendingLaunchBatches: LaunchParamsLike[] = [];
let activeLaunchSubscriber: ((files: LoadedMarkdownFile[]) => void) | null = null;
let launchProcessingChain: Promise<void> = Promise.resolve();

async function processLaunchParams(params: LaunchParamsLike): Promise<void> {
  if (!params.files || params.files.length === 0) return;
  const loaded: LoadedMarkdownFile[] = [];
  for (const handle of params.files) {
    try {
      if ('kind' in handle && handle.kind !== 'file') continue;
      const file = await handle.getFile();
      if (!isMarkdownFilename(file.name)) continue;
      loaded.push({
        title: file.name,
        content: await file.text(),
        fileHandle: handle,
        lastModified: file.lastModified,
      });
    } catch {
      // Skip unreadable handles
    }
  }
  if (loaded.length > 0 && activeLaunchSubscriber) {
    activeLaunchSubscriber(loaded);
  }
}

export function ensureLaunchQueueInitialized(): void {
  if (typeof window === 'undefined' || typeof window.launchQueue?.setConsumer !== 'function') {
    return;
  }
  if (registeredSetConsumer === window.launchQueue.setConsumer) {
    return;
  }
  registeredSetConsumer = window.launchQueue.setConsumer;
  window.launchQueue.setConsumer((launchParams) => {
    if (!launchParams?.files || launchParams.files.length === 0) return;
    if (!activeLaunchSubscriber) {
      pendingLaunchBatches.push(launchParams);
      return;
    }
    launchProcessingChain = launchProcessingChain.then(() => processLaunchParams(launchParams));
  });
}

ensureLaunchQueueInitialized();

export function subscribeLaunchQueue(onFiles: (files: LoadedMarkdownFile[]) => void): () => void {
  activeLaunchSubscriber = onFiles;
  ensureLaunchQueueInitialized();
  if (pendingLaunchBatches.length > 0) {
    const queued = pendingLaunchBatches;
    pendingLaunchBatches = [];
    for (const batch of queued) {
      launchProcessingChain = launchProcessingChain.then(() => processLaunchParams(batch));
    }
  }
  return () => {
    if (activeLaunchSubscriber === onFiles) {
      activeLaunchSubscriber = null;
    }
  };
}
