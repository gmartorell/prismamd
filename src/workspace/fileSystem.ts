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
}

export interface FolderEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  handle: FileSystemFileHandle | FileSystemDirectoryHandle;
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
}

export interface PersistedSession {
  tabs: PersistedTabSnapshot[];
  activeTabId: string;
  viewMode: ViewMode;
  theme: ThemeMode;
  explorerOpen: boolean;
  outlineOpen: boolean;
  scrollSync: boolean;
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

export function isMarkdownFilename(name: string): boolean {
  return MARKDOWN_FILE_RE.test(name);
}

export function createTabId(): string {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function saveSessionToStorage(session: PersistedSession, tabs: EditorTab[]): Promise<void> {
  try {
    await idbSet(SESSION_KEY, session);
    const handlesObj: Record<string, FileSystemFileHandle> = {};
    for (const tab of tabs) {
      if (tab.fileHandle) {
        handlesObj[tab.id] = tab.fileHandle;
      }
    }
    await idbSet(FILE_HANDLES_KEY, handlesObj);
  } catch {
    // Fallback quietly if IndexedDB is unavailable
  }
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
  try {
    await idbSet(DIR_HANDLE_KEY, handle);
  } catch {
    // Ignore IDB errors
  }
}

export async function isDirectoryWritable(handle: FileSystemDirectoryHandle): Promise<boolean> {
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

export async function ensureFilePermission(handle: FileSystemFileHandle): Promise<boolean> {
  const permHandle = handle as unknown as HandleWithPermission;
  if (permHandle.queryPermission) {
    const current = await permHandle.queryPermission({ mode: 'readwrite' });
    if (current === 'granted') return true;
  }
  if (permHandle.requestPermission) {
    const requested = await permHandle.requestPermission({ mode: 'readwrite' });
    return requested === 'granted';
  }
  return true;
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
      });
    }
    return results;
  }

  return await new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.md,.markdown,.mdx,.mdown,text/markdown';
    input.onchange = async () => {
      const files = Array.from(input.files ?? []).filter((f) => isMarkdownFilename(f.name));
      const loaded = await Promise.all(
        files.map(async (f) => ({
          title: f.name,
          content: await f.text(),
        })),
      );
      resolve(loaded);
    };
    input.click();
  });
}

function triggerBrowserDownload(filename: string, content: string, mime = 'text/markdown;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.md') || filename.endsWith('.markdown') ? filename : `${filename}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function saveTabToDisk(
  tab: EditorTab,
  forceSaveAs = false,
): Promise<{ title: string; fileHandle?: FileSystemFileHandle }> {
  if (!forceSaveAs && tab.fileHandle) {
    const ok = await ensureFilePermission(tab.fileHandle);
    if (ok) {
      const writable = await tab.fileHandle.createWritable();
      await writable.write(tab.content);
      await writable.close();
      return { title: tab.fileHandle.name, fileHandle: tab.fileHandle };
    }
    // Read-only handle: fall through to Save As picker or browser download
  }

  if (typeof window.showSaveFilePicker === 'function') {
    const suggestedName = tab.isScratchpad ? 'nota-rapida.md' : tab.title;
    const handle = await window.showSaveFilePicker({
      suggestedName,
      types: [
        {
          description: 'Markdown',
          accept: { 'text/markdown': ['.md', '.markdown'] },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(tab.content);
    await writable.close();
    return { title: handle.name, fileHandle: handle };
  }

  const downloadName = tab.isScratchpad ? 'nota-rapida.md' : tab.title;
  triggerBrowserDownload(downloadName, tab.content);
  return { title: downloadName, fileHandle: undefined };
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

export async function openFolderPicker(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof window.showDirectoryPicker !== 'function') {
    return null;
  }
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      throw err;
    }
    return await window.showDirectoryPicker({ mode: 'read' });
  }
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
  rawName: string,
): Promise<{ title: string; content: string; fileHandle: FileSystemFileHandle; relativePath: string }> {
  const clean = rawName.trim().replace(/[/\\]/g, '');
  const title = isMarkdownFilename(clean) ? clean : `${clean || 'nueva-nota'}.md`;
  const fileHandle = await dirHandle.getFileHandle(title, { create: true });
  const initialContent = `# ${title.replace(/\.[^.]+$/, '')}\n\n`;
  const writable = await fileHandle.createWritable();
  await writable.write(initialContent);
  await writable.close();
  return {
    title,
    content: initialContent,
    fileHandle,
    relativePath: title,
  };
}

export interface IncomingExtensionPayload {
  filename: string;
  content: string;
  sourceUrl?: string;
}

export async function consumeExtensionIncomingFile(): Promise<IncomingExtensionPayload | null> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const data = await chrome.storage.local.get(VIEWER_INCOMING_KEY);
      const payload = data[VIEWER_INCOMING_KEY] as IncomingExtensionPayload | undefined;
      if (payload && typeof payload.content === 'string') {
        await chrome.storage.local.remove(VIEWER_INCOMING_KEY);
        return payload;
      }
    }
  } catch {
    // Not in extension context
  }
  return null;
}

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
