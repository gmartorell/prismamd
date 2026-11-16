import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { PreviewEditor, type PreviewEditorHandle } from '../editors/preview/PreviewEditor';
import { RawEditor, type RawEditorHandle } from '../editors/raw/RawEditor';
import { formatMessage, getRegisteredLocales, isDefaultDemoMarkdown, useI18n } from '../i18n';
import { computeDocumentStats, extractHeadingsOutline, type OutlineHeading } from '../markdown/bridge';
import { fileToMarkdownImage } from '../markdown/imageDataUri';
import type { ThemeMode } from '../renderers/mermaidRenderer';
import { copyAsRichText, exportPrintPdf, exportStandaloneHtml } from '../utils/exporter';
import {
  applyPendingUpdate,
  checkForAppUpdates,
  getCurrentVersion,
  getRuntimeChannel,
  subscribePwaUpdateReady,
  type UpdateCheckResult,
} from '../utils/version';
import {
  consumeExtensionIncomingFile,
  consumePendingScratchpadAppend,
  createFileInFolder,
  createTabId,
  ensureDirectoryPermission,
  isDirectoryWritable,
  isMarkdownFilename,
  isSameFileHandle,
  loadSavedDirectoryHandle,
  loadSessionFromStorage,
  mergeOpenedFilesIntoTabs,
  mergeRestoredSessionTabs,
  normalizeViewMode,
  openFolderPicker,
  openMarkdownFilesFromPicker,
  readDirectoryChildren,
  saveDirectoryHandle,
  saveSessionToStorage,
  saveTabToDisk,
  subscribeLaunchQueue,
  updateDirectoryEntry,
  type EditorTab,
  type FolderEntry,
  type LoadedMarkdownFile,
  type ViewMode,
} from '../workspace/fileSystem';
import { CommandPalette, type PaletteCommand } from './CommandPalette';
import { FolderSidebar } from './FolderSidebar';
import { OutlineSidebar } from './OutlineSidebar';
import { StatusBar } from './StatusBar';
import { TabBar } from './TabBar';
import { TopToolbar, type FormatCommand } from './TopToolbar';
import { VersionModal } from './VersionModal';

const VIEW_MODE_LS_KEY = 'prismamd.viewMode';
const THEME_LS_KEY = 'prismamd.theme';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isCompactScreenNow(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(max-width: 768px)').matches;
}

function readInitialViewMode(isSidePanel: boolean): ViewMode {
  if (isSidePanel) return 'preview';
  const defaultMode: ViewMode = isCompactScreenNow() ? 'preview' : 'split';
  try {
    const saved = localStorage.getItem(VIEW_MODE_LS_KEY);
    return normalizeViewMode(saved, defaultMode);
  } catch {
    // Ignore storage errors
  }
  return defaultMode;
}

function readInitialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_LS_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'sepia') return saved;
  } catch {
    // Ignore storage errors
  }
  return 'dark';
}

export function AppShell() {
  const { locale, t, setLocale } = useI18n();
  const isSidePanel = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('mode') === 'sidepanel';
  }, []);

  const [isCompactViewport, setIsCompactViewport] = useState<boolean>(() => isCompactScreenNow());
  const [viewMode, setViewModeState] = useState<ViewMode>(() => readInitialViewMode(isSidePanel));
  const [theme, setThemeState] = useState<ThemeMode>(() => readInitialTheme());
  const [explorerOpen, setExplorerOpen] = useState(() => !isSidePanel && !isCompactScreenNow());
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [zenMode, setZenMode] = useState(false);
  const [scrollSync, setScrollSync] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateCheckResult>(() => ({
    status: 'idle',
    currentVersion: getCurrentVersion(),
  }));
  const [toast, setToast] = useState<string | null>(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  const [tabs, setTabs] = useState<EditorTab[]>(() => [
    {
      id: 'scratchpad',
      title: t.files.scratchpad,
      content: t.demoMarkdown,
      savedContent: t.demoMarkdown,
      isScratchpad: true,
    },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('scratchpad');

  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [folderEntries, setFolderEntries] = useState<FolderEntry[]>([]);
  const [folderNeedsPermission, setFolderNeedsPermission] = useState(false);
  const [folderLoading, setFolderLoading] = useState(false);
  const [folderReadOnly, setFolderReadOnly] = useState(false);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [tabs, activeTabId],
  );

  // Synced markdown for Preview editor (debounced slightly on raw typing for 120 FPS)
  const [previewMarkdown, setPreviewMarkdown] = useState(activeTab.content);
  const rawDebounceRef = useRef<number | null>(null);
  const lastEditSourceRef = useRef<'raw' | 'preview' | 'external'>('external');
  const lastFocusedPaneRef = useRef<'raw' | 'preview'>('preview');
  const prevTabIdRef = useRef(activeTab.id);
  const prevViewModeRef = useRef(viewMode);

  const rawRef = useRef<RawEditorHandle | null>(null);
  const previewRef = useRef<PreviewEditorHandle | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const syncingScrollFromRef = useRef<'raw' | 'preview' | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const latestTabsRef = useRef<EditorTab[]>(tabs);
  const osLaunchOccurredRef = useRef(false);
  const openQueueRef = useRef<Promise<void>>(Promise.resolve());

  const commitTabs = useCallback((updater: EditorTab[] | ((prev: EditorTab[]) => EditorTab[])): EditorTab[] => {
    const next = typeof updater === 'function' ? updater(latestTabsRef.current) : updater;
    latestTabsRef.current = next;
    setTabs(next);
    return next;
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const setViewMode = useCallback((next: ViewMode) => {
    setViewModeState(next);
    try {
      if (!isSidePanel) localStorage.setItem(VIEW_MODE_LS_KEY, next);
    } catch {
      // Ignore
    }
  }, [isSidePanel]);

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next);
    try {
      localStorage.setItem(THEME_LS_KEY, next);
    } catch {
      // Ignore
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(max-width: 768px)');
    const onChange = () => setIsCompactViewport(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setInstallPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const handleCheckUpdates = useCallback(async () => {
    const currentVersion = getCurrentVersion();
    setUpdateState((prev) => ({ ...prev, status: 'checking', currentVersion }));
    const result = await checkForAppUpdates(currentVersion);
    setUpdateState(result);
  }, []);

  useEffect(() => {
    const currentVersion = getCurrentVersion();
    const unsubSw = subscribePwaUpdateReady((result) => {
      setUpdateState(result);
    });
    if (getRuntimeChannel() === 'pwa' && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
      void checkForAppUpdates(currentVersion).then((res) => {
        if (res.status === 'update-available' || res.status === 'up-to-date') {
          setUpdateState(res);
        }
      });
    }
    return unsubSw;
  }, []);

  const handleInstallApp = useCallback(async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }, [installPrompt]);

  // Keep previewMarkdown aligned on external updates, tab switches, or view mode changes
  useEffect(() => {
    const tabChanged = prevTabIdRef.current !== activeTab.id;
    const viewModeChanged = prevViewModeRef.current !== viewMode;
    prevTabIdRef.current = activeTab.id;
    prevViewModeRef.current = viewMode;

    if (lastEditSourceRef.current === 'external' || tabChanged || viewModeChanged) {
      if (rawDebounceRef.current) {
        window.clearTimeout(rawDebounceRef.current);
        rawDebounceRef.current = null;
      }
      setPreviewMarkdown(activeTab.content);
    }
  }, [activeTab.id, activeTab.content, viewMode]);

  // When switching locale and scratchpad still holds unmodified default demo text, refresh demo text cleanly
  const prevDemoRef = useRef(t.demoMarkdown);
  useEffect(() => {
    const prevDemo = prevDemoRef.current;
    prevDemoRef.current = t.demoMarkdown;
    commitTabs((prev) => {
      let contentChanged = false;
      const next = prev.map((tab) => {
        if (!tab.isScratchpad) return tab;
        if (tab.content === prevDemo || isDefaultDemoMarkdown(tab.content)) {
          if (tab.content !== t.demoMarkdown) {
            contentChanged = true;
          }
          return {
            ...tab,
            title: t.files.scratchpad,
            content: t.demoMarkdown,
            savedContent: t.demoMarkdown,
          };
        }
        return tab.title === t.files.scratchpad ? tab : { ...tab, title: t.files.scratchpad };
      });
      if (contentChanged) {
        lastEditSourceRef.current = 'external';
      }
      return next;
    });
  }, [commitTabs, t.demoMarkdown, t.files.scratchpad]);

  const openFilesAsTabs = useCallback(
    (incoming: LoadedMarkdownFile[]): Promise<void> => {
      if (incoming.length === 0) return Promise.resolve();

      openQueueRef.current = openQueueRef.current.then(async () => {
        const snapshot = latestTabsRef.current;
        const prepared: LoadedMarkdownFile[] = [];

        for (const item of incoming) {
          let matchedTabId = item.matchedTabId;
          if (!matchedTabId && item.fileHandle) {
            for (const existing of snapshot) {
              if (existing.isScratchpad || !existing.fileHandle) continue;
              if (await isSameFileHandle(existing.fileHandle, item.fileHandle)) {
                matchedTabId = existing.id;
                break;
              }
            }
          }
          prepared.push({ ...item, matchedTabId });
        }

        lastEditSourceRef.current = 'external';
        const { tabs: nextTabs, targetActiveId } = mergeOpenedFilesIntoTabs(latestTabsRef.current, prepared);
        commitTabs(nextTabs);
        if (targetActiveId) {
          setActiveTabId(targetActiveId);
        }
      });

      return openQueueRef.current;
    },
    [commitTabs],
  );

  // Restore session, directory handle, extension handoffs & PWA launchQueue on boot
  useEffect(() => {
    let active = true;

    const unsubscribeLaunchQueue = subscribeLaunchQueue((files) => {
      osLaunchOccurredRef.current = true;
      void openFilesAsTabs(files);
    });

    async function hydrate() {
      const [{ session, fileHandles }, savedDir, incomingExt, pendingAppend] = await Promise.all([
        loadSessionFromStorage(),
        loadSavedDirectoryHandle(),
        consumeExtensionIncomingFile(),
        consumePendingScratchpadAppend(),
      ]);

      if (!active) return;

      if (session && Array.isArray(session.tabs) && session.tabs.length > 0) {
        const restoredTabs: EditorTab[] = session.tabs.map((snap) => ({
          ...snap,
          fileHandle: fileHandles[snap.id],
        }));
        if (!restoredTabs.some((tb) => tb.isScratchpad)) {
          restoredTabs.unshift({
            id: 'scratchpad',
            title: t.files.scratchpad,
            content: t.demoMarkdown,
            savedContent: t.demoMarkdown,
            isScratchpad: true,
          });
        }
        if (pendingAppend) {
          const sp = restoredTabs.find((tb) => tb.isScratchpad);
          if (sp) {
            sp.content = `${sp.content.trimEnd()}\n\n> ${pendingAppend.replace(/\n/g, '\n> ')}\n`;
          }
        }

        const duplicateBootTabIds = new Map<string, string>();
        for (const bootTab of latestTabsRef.current) {
          if (bootTab.isScratchpad || !bootTab.fileHandle) continue;
          for (const restoredTab of restoredTabs) {
            if (restoredTab.isScratchpad || !restoredTab.fileHandle) continue;
            if (await isSameFileHandle(bootTab.fileHandle, restoredTab.fileHandle)) {
              duplicateBootTabIds.set(bootTab.id, restoredTab.id);
              break;
            }
          }
        }

        if (!active) return;

        lastEditSourceRef.current = 'external';
        commitTabs((currentTabs) => mergeRestoredSessionTabs(currentTabs, restoredTabs, duplicateBootTabIds));
        if (!osLaunchOccurredRef.current && restoredTabs.some((tb) => tb.id === session.activeTabId)) {
          setActiveTabId(session.activeTabId);
        }
        if (!isSidePanel && !isCompactScreenNow()) {
          setViewModeState(normalizeViewMode(session.viewMode));
          setExplorerOpen(session.explorerOpen);
          setOutlineOpen(session.outlineOpen);
        } else if (isCompactScreenNow()) {
          setExplorerOpen(false);
          setOutlineOpen(false);
        }
        setThemeState(session.theme);
        setScrollSync(session.scrollSync ?? true);
      } else if (pendingAppend) {
        lastEditSourceRef.current = 'external';
        commitTabs((prev) =>
          prev.map((tb) =>
            tb.isScratchpad
              ? { ...tb, content: `${tb.content.trimEnd()}\n\n> ${pendingAppend.replace(/\n/g, '\n> ')}\n` }
              : tb,
          ),
        );
      }

      if (incomingExt) {
        osLaunchOccurredRef.current = true;
        await openFilesAsTabs([
          {
            title: incomingExt.filename,
            content: incomingExt.content,
            relativePath: incomingExt.sourceUrl,
          },
        ]);
        showToast(t.files.importedFromViewer);
      }

      if (savedDir.handle) {
        setDirHandle(savedDir.handle);
        setFolderReadOnly(savedDir.readOnly);
        if (savedDir.granted) {
          setFolderNeedsPermission(false);
          setFolderLoading(true);
          try {
            const entries = await readDirectoryChildren(savedDir.handle);
            if (active) setFolderEntries(entries);
          } catch {
            if (active) setFolderEntries([]);
          } finally {
            if (active) setFolderLoading(false);
          }
        } else {
          setFolderNeedsPermission(true);
        }
      }
    }

    void hydrate();

    const handleChromeStorageChange = (
      changes: Record<string, { newValue?: unknown }>,
      areaName: string,
    ) => {
      if (areaName !== 'local') return;
      if (changes.prismamd_incoming_md?.newValue) {
        void consumeExtensionIncomingFile().then((payload) => {
          if (payload) {
            void openFilesAsTabs([
              { title: payload.filename, content: payload.content, relativePath: payload.sourceUrl },
            ]);
          }
        });
      }
      if (changes.prismamd_scratchpad_append?.newValue) {
        void consumePendingScratchpadAppend().then((text) => {
          if (text) {
            lastEditSourceRef.current = 'external';
            commitTabs((prev) =>
              prev.map((tb) =>
                tb.isScratchpad
                  ? { ...tb, content: `${tb.content.trimEnd()}\n\n> ${text.replace(/\n/g, '\n> ')}\n` }
                  : tb,
              ),
            );
            setActiveTabId('scratchpad');
          }
        });
      }
    };

    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener(handleChromeStorageChange);
      }
    } catch {
      // Ignore outside extension context
    }

    return () => {
      active = false;
      unsubscribeLaunchQueue();
      try {
        if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
          chrome.storage.onChanged.removeListener(handleChromeStorageChange);
        }
      } catch {
        // Ignore
      }
    };
  }, [commitTabs, openFilesAsTabs]);

  // Persist session debounced to IndexedDB
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void saveSessionToStorage(
        {
          tabs: tabs.map((tb) => ({
            id: tb.id,
            title: tb.title,
            content: tb.content,
            savedContent: tb.savedContent,
            isScratchpad: tb.isScratchpad,
            relativePath: tb.relativePath,
          })),
          activeTabId,
          viewMode,
          theme,
          explorerOpen,
          outlineOpen,
          scrollSync,
        },
        tabs,
      );
    }, 350);
    return () => window.clearTimeout(timer);
  }, [tabs, activeTabId, viewMode, theme, explorerOpen, outlineOpen, scrollSync]);

  const updateActiveContent = useCallback(
    (nextMarkdown: string, source: 'raw' | 'preview') => {
      lastEditSourceRef.current = source;
      commitTabs((prev) =>
        prev.map((tab) => (tab.id === activeTab.id ? { ...tab, content: nextMarkdown } : tab)),
      );

      if (source === 'preview') {
        if (rawDebounceRef.current) {
          window.clearTimeout(rawDebounceRef.current);
          rawDebounceRef.current = null;
        }
        setPreviewMarkdown(nextMarkdown);
      } else {
        if (rawDebounceRef.current) window.clearTimeout(rawDebounceRef.current);
        rawDebounceRef.current = window.setTimeout(() => {
          setPreviewMarkdown(nextMarkdown);
        }, 55);
      }
    },
    [activeTab.id, commitTabs],
  );

  const handleSelectTab = useCallback((tabId: string) => {
    lastEditSourceRef.current = 'external';
    setActiveTabId(tabId);
  }, []);

  const handleNewTab = useCallback(() => {
    const id = createTabId();
    const newTab: EditorTab = {
      id,
      title: t.files.untitled,
      content: `# ${t.files.newNote}\n\n`,
      savedContent: `# ${t.files.newNote}\n\n`,
    };
    lastEditSourceRef.current = 'external';
    commitTabs((prev) => [...prev, newTab]);
    setActiveTabId(id);
  }, [commitTabs, t.files.newNote, t.files.untitled]);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const target = latestTabsRef.current.find((tb) => tb.id === tabId);
      if (!target || target.isScratchpad) return;
      const isDirty = target.content !== target.savedContent;
      if (isDirty) {
        const confirmed = window.confirm(
          formatMessage(t.files.confirmCloseUnsaved, { name: target.title }),
        );
        if (!confirmed) return;
      }

      if (activeTabId === tabId) {
        lastEditSourceRef.current = 'external';
      }
      commitTabs((prev) => {
        const idx = prev.findIndex((tb) => tb.id === tabId);
        const next = prev.filter((tb) => tb.id !== tabId);
        if (activeTabId === tabId) {
          const fallback = next[Math.max(0, idx - 1)] ?? next[0];
          if (fallback) setActiveTabId(fallback.id);
        }
        return next;
      });
    },
    [activeTabId, commitTabs, t.files.confirmCloseUnsaved],
  );

  const handleOpenFile = useCallback(async () => {
    try {
      const loaded = await openMarkdownFilesFromPicker();
      await openFilesAsTabs(loaded);
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        showToast(t.files.openErrorToast);
      }
    }
  }, [openFilesAsTabs, showToast, t.files.openErrorToast]);

  const handleOpenFolder = useCallback(async () => {
    try {
      const handle = await openFolderPicker();
      if (!handle) return;
      setDirHandle(handle);
      setFolderNeedsPermission(false);
      setFolderEntries([]);
      setFolderLoading(true);
      setExplorerOpen(true);

      const writable = await isDirectoryWritable(handle);
      setFolderReadOnly(!writable);

      const entries = await readDirectoryChildren(handle);
      setFolderEntries(entries);
      await saveDirectoryHandle(handle);
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        showToast(t.files.folderErrorToast);
      }
    } finally {
      setFolderLoading(false);
    }
  }, [showToast, t.files.folderErrorToast]);

  const handleReconnectFolder = useCallback(async () => {
    if (!dirHandle) return;
    setFolderLoading(true);
    try {
      const { granted, readOnly } = await ensureDirectoryPermission(dirHandle);
      setFolderReadOnly(readOnly);
      if (granted) {
        setFolderNeedsPermission(false);
        const entries = await readDirectoryChildren(dirHandle);
        setFolderEntries(entries);
      }
    } catch {
      showToast(t.files.folderErrorToast);
    } finally {
      setFolderLoading(false);
    }
  }, [dirHandle, showToast, t.files.folderErrorToast]);

  const handleRefreshFolder = useCallback(async () => {
    if (!dirHandle) return;
    setFolderLoading(true);
    try {
      const writable = await isDirectoryWritable(dirHandle);
      setFolderReadOnly(!writable);
      const entries = await readDirectoryChildren(dirHandle);
      setFolderEntries(entries);
    } catch {
      showToast(t.files.folderErrorToast);
    } finally {
      setFolderLoading(false);
    }
  }, [dirHandle, showToast, t.files.folderErrorToast]);

  const handleCloseFolder = useCallback(() => {
    setDirHandle(null);
    setFolderEntries([]);
    setFolderNeedsPermission(false);
    setFolderReadOnly(false);
    setFolderLoading(false);
    void saveDirectoryHandle(null);
  }, []);

  const handleExpandDirectory = useCallback(
    async (entry: FolderEntry) => {
      if (entry.kind !== 'directory' || entry.loaded || entry.loading) return;
      setFolderEntries((prev) =>
        updateDirectoryEntry(prev, entry.path, (item) => ({ ...item, loading: true })),
      );
      try {
        const children = await readDirectoryChildren(
          entry.handle as FileSystemDirectoryHandle,
          entry.path,
        );
        setFolderEntries((prev) =>
          updateDirectoryEntry(prev, entry.path, (item) => ({
            ...item,
            children,
            loaded: true,
            loading: false,
          })),
        );
      } catch {
        setFolderEntries((prev) =>
          updateDirectoryEntry(prev, entry.path, (item) => ({
            ...item,
            children: [],
            loaded: true,
            loading: false,
          })),
        );
        showToast(t.files.folderErrorToast);
      }
    },
    [showToast, t.files.folderErrorToast],
  );

  const handleSelectTreeFile = useCallback(
    async (entry: FolderEntry) => {
      if (entry.kind !== 'file') return;
      try {
        const fileHandle = entry.handle as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        await openFilesAsTabs([
          {
            title: file.name,
            content: await file.text(),
            fileHandle,
            relativePath: entry.path,
          },
        ]);
        if (isCompactScreenNow()) {
          setExplorerOpen(false);
        }
      } catch {
        showToast(t.files.openErrorToast);
      }
    },
    [openFilesAsTabs, showToast, t.files.openErrorToast],
  );

  const handleCreateFileInFolder = useCallback(
    async (filename: string) => {
      if (!dirHandle) return;
      const created = await createFileInFolder(dirHandle, filename);
      await openFilesAsTabs([created]);
      const entries = await readDirectoryChildren(dirHandle);
      setFolderEntries(entries);
    },
    [dirHandle, openFilesAsTabs],
  );

  const handleSave = useCallback(
    async (forceSaveAs = false) => {
      try {
        const res = await saveTabToDisk(activeTab, forceSaveAs);
        commitTabs((prev) =>
          prev.map((tab) =>
            tab.id === activeTab.id
              ? {
                  ...tab,
                  title: tab.isScratchpad ? tab.title : res.title,
                  fileHandle: res.fileHandle ?? tab.fileHandle,
                  savedContent: tab.content,
                }
              : tab,
          ),
        );
        showToast(formatMessage(t.files.savedToast, { name: res.title }));
        if (dirHandle) {
          void handleRefreshFolder();
        }
      } catch (err) {
        if ((err as { name?: string })?.name !== 'AbortError') {
          showToast(t.files.saveErrorToast);
        }
      }
    },
    [activeTab, commitTabs, dirHandle, handleRefreshFolder, showToast, t.files.saveErrorToast, t.files.savedToast],
  );

  const handleFormatCommand = useCallback(
    (cmd: FormatCommand) => {
      const useRaw =
        viewMode === 'raw' || (viewMode === 'split' && lastFocusedPaneRef.current === 'raw');

      if (useRaw && rawRef.current) {
        switch (cmd) {
          case 'bold':
            rawRef.current.wrapSelection('**');
            break;
          case 'italic':
            rawRef.current.wrapSelection('*');
            break;
          case 'code':
            rawRef.current.wrapSelection('`');
            break;
          case 'taskList':
            rawRef.current.insertSnippet('\n- [ ] ');
            break;
          case 'table':
            rawRef.current.insertSnippet(
              '\n| Columna 1 | Columna 2 | Columna 3 |\n| :--- | :---: | ---: |\n| A | B | C |\n',
            );
            break;
          case 'mermaid':
            rawRef.current.insertSnippet('\n```mermaid\nflowchart LR\n  A[Start] --> B[End]\n```\n');
            break;
          case 'mathInline':
            rawRef.current.wrapSelection('$', '$');
            break;
          case 'mathBlock':
            rawRef.current.insertSnippet('\n$$\nE = mc^2\n$$\n');
            break;
          case 'alert':
            rawRef.current.insertSnippet('\n> [!NOTE]\n> ');
            break;
        }
        return;
      }

      previewRef.current?.runAction(cmd);
    },
    [viewMode],
  );

  const handleInsertImageRequest = useCallback(() => {
    imageInputRef.current?.click();
  }, []);

  const handleChosenImageFile = useCallback(
    async (file: File) => {
      const useRaw =
        viewMode === 'raw' || (viewMode === 'split' && lastFocusedPaneRef.current === 'raw');
      if (useRaw && rawRef.current) {
        const res = await fileToMarkdownImage(file);
        rawRef.current.insertSnippet(`\n${res.markdown}\n`);
      } else if (previewRef.current) {
        await previewRef.current.insertImageFromFile(file);
      }
    },
    [viewMode],
  );

  const handleOpenSearch = useCallback(() => {
    if (viewMode === 'preview') {
      setViewMode('split');
      window.setTimeout(() => rawRef.current?.openSearch(), 50);
    } else {
      rawRef.current?.openSearch();
    }
  }, [viewMode, setViewMode]);

  const handleExportHtml = useCallback(async () => {
    await exportStandaloneHtml(activeTab.title, activeTab.content, theme);
    showToast(t.exportMenu.exportedHtml);
  }, [activeTab.content, activeTab.title, theme, showToast, t.exportMenu.exportedHtml]);

  const handleExportPdf = useCallback(async () => {
    await exportPrintPdf(activeTab.title, activeTab.content, theme);
  }, [activeTab.content, activeTab.title, theme]);

  const handleCopyRichText = useCallback(async () => {
    try {
      await copyAsRichText(activeTab.content, theme);
      showToast(t.exportMenu.copiedRichText);
    } catch {
      showToast(t.exportMenu.copyError);
    }
  }, [activeTab.content, theme, showToast, t.exportMenu.copiedRichText, t.exportMenu.copyError]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        setZenMode((v) => !v);
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void handleSave(e.shiftKey);
        return;
      }
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void handleOpenFile();
        return;
      }
      if (mod && e.key === '1') {
        e.preventDefault();
        setViewMode('raw');
        return;
      }
      if (mod && e.key === '2') {
        e.preventDefault();
        setViewMode('split');
        return;
      }
      if (mod && e.key === '3') {
        e.preventDefault();
        setViewMode('preview');
        return;
      }
      if (e.key === 'Escape' && zenMode && !paletteOpen) {
        setZenMode(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSave, handleOpenFile, setViewMode, zenMode, paletteOpen]);

  const headings = useMemo(() => extractHeadingsOutline(activeTab.content), [activeTab.content]);
  const stats = useMemo(() => computeDocumentStats(activeTab.content), [activeTab.content]);

  const handleSelectHeading = useCallback((heading: OutlineHeading, index: number) => {
    rawRef.current?.scrollToLine(heading.line);
    previewRef.current?.scrollToHeading(index, heading.text);
    if (isCompactScreenNow()) {
      setOutlineOpen(false);
    }
  }, []);

  const handleRawScrollRatio = useCallback(
    (ratio: number) => {
      if (!scrollSync || viewMode !== 'split' || syncingScrollFromRef.current === 'preview') return;
      syncingScrollFromRef.current = 'raw';
      previewRef.current?.setScrollRatio(ratio);
      requestAnimationFrame(() => {
        syncingScrollFromRef.current = null;
      });
    },
    [scrollSync, viewMode],
  );

  const handlePreviewScrollRatio = useCallback(
    (ratio: number) => {
      if (!scrollSync || viewMode !== 'split' || syncingScrollFromRef.current === 'raw') return;
      syncingScrollFromRef.current = 'preview';
      rawRef.current?.setScrollRatio(ratio);
      requestAnimationFrame(() => {
        syncingScrollFromRef.current = null;
      });
    },
    [scrollSync, viewMode],
  );

  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    const cmds: PaletteCommand[] = [
      { id: 'view-raw', category: t.palette.categories.view, title: t.views.raw, shortcut: 'Ctrl+1', run: () => setViewMode('raw') },
      { id: 'view-split', category: t.palette.categories.view, title: t.views.split, shortcut: 'Ctrl+2', run: () => setViewMode('split') },
      { id: 'view-preview', category: t.palette.categories.view, title: t.views.preview, shortcut: 'Ctrl+3', run: () => setViewMode('preview') },
      { id: 'view-zen', category: t.palette.categories.view, title: t.toolbar.zenMode, shortcut: 'Ctrl+Shift+Z', run: () => setZenMode((v) => !v) },
      { id: 'view-explorer', category: t.palette.categories.view, title: t.sidebars.toggleExplorer, run: () => setExplorerOpen((v) => !v) },
      { id: 'view-outline', category: t.palette.categories.view, title: t.sidebars.toggleOutline, run: () => setOutlineOpen((v) => !v) },
      {
        id: 'app-version',
        category: t.palette.categories.view,
        title: `${t.about.menuCommand} (v${updateState.currentVersion})`,
        run: () => {
          setAboutOpen(true);
          void handleCheckUpdates();
        },
      },

      { id: 'file-new', category: t.palette.categories.file, title: t.files.newNote, run: handleNewTab },
      { id: 'file-open', category: t.palette.categories.file, title: t.files.openFile, shortcut: 'Ctrl+O', run: () => void handleOpenFile() },
      { id: 'file-folder', category: t.palette.categories.file, title: t.files.openFolder, run: () => void handleOpenFolder() },
      { id: 'file-save', category: t.palette.categories.file, title: t.files.save, shortcut: 'Ctrl+S', run: () => void handleSave(false) },
      { id: 'file-save-as', category: t.palette.categories.file, title: t.files.saveAs, shortcut: 'Ctrl+Shift+S', run: () => void handleSave(true) },

      { id: 'fmt-table', category: t.palette.categories.format, title: t.toolbar.table, run: () => handleFormatCommand('table') },
      { id: 'fmt-mermaid', category: t.palette.categories.format, title: t.toolbar.mermaid, run: () => handleFormatCommand('mermaid') },
      { id: 'fmt-math', category: t.palette.categories.format, title: t.toolbar.mathBlock, run: () => handleFormatCommand('mathBlock') },
      { id: 'fmt-alert', category: t.palette.categories.format, title: t.toolbar.alert, run: () => handleFormatCommand('alert') },
      { id: 'fmt-image', category: t.palette.categories.format, title: t.toolbar.insertImage, run: handleInsertImageRequest },
      { id: 'fmt-search', category: t.palette.categories.format, title: t.toolbar.search, shortcut: 'Ctrl+F', run: handleOpenSearch },

      { id: 'theme-light', category: t.palette.categories.theme, title: `${t.themes.label}: ${t.themes.light}`, run: () => setTheme('light') },
      { id: 'theme-dark', category: t.palette.categories.theme, title: `${t.themes.label}: ${t.themes.dark}`, run: () => setTheme('dark') },
      { id: 'theme-sepia', category: t.palette.categories.theme, title: `${t.themes.label}: ${t.themes.sepia}`, run: () => setTheme('sepia') },

      { id: 'exp-html', category: t.palette.categories.export, title: t.exportMenu.exportHtml, run: () => void handleExportHtml() },
      { id: 'exp-pdf', category: t.palette.categories.export, title: t.exportMenu.exportPdf, run: () => void handleExportPdf() },
      { id: 'exp-rich', category: t.palette.categories.export, title: t.exportMenu.copyRichText, run: () => void handleCopyRichText() },
    ];

    for (const loc of getRegisteredLocales()) {
      cmds.push({
        id: `lang-${loc.code}`,
        category: t.palette.categories.language,
        title: `${t.language.label}: ${loc.nativeName}`,
        run: () => setLocale(loc.code),
      });
    }

    return cmds;
  }, [
    t,
    locale,
    setViewMode,
    handleNewTab,
    handleOpenFile,
    handleOpenFolder,
    handleSave,
    handleFormatCommand,
    handleInsertImageRequest,
    handleOpenSearch,
    setTheme,
    handleExportHtml,
    handleExportPdf,
    handleCopyRichText,
    setLocale,
    updateState.currentVersion,
    handleCheckUpdates,
  ]);

  const isDirty = activeTab.content !== activeTab.savedContent && !activeTab.isScratchpad;

  const handleWindowDrop = async (e: DragEvent) => {
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    const mdFiles = Array.from(files).filter((f) => isMarkdownFilename(f.name));
    if (mdFiles.length === 0) return;
    e.preventDefault();
    const loaded = await Promise.all(
      mdFiles.map(async (f) => ({
        title: f.name,
        content: await f.text(),
      })),
    );
    await openFilesAsTabs(loaded);
  };

  return (
    <div
      className={`app-shell ${zenMode ? 'zen-mode' : ''} ${isSidePanel ? 'sidepanel-mode' : ''}`}
      data-theme={theme}
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => void handleWindowDrop(e)}
    >
      <TopToolbar
        viewMode={viewMode}
        onChangeViewMode={setViewMode}
        theme={theme}
        onChangeTheme={setTheme}
        isDirty={isDirty}
        isSidePanel={isSidePanel}
        explorerOpen={explorerOpen}
        outlineOpen={outlineOpen}
        zenMode={zenMode}
        onToggleExplorer={() => {
          setExplorerOpen((v) => {
            const next = !v;
            if (next && isCompactScreenNow()) setOutlineOpen(false);
            return next;
          });
        }}
        onToggleOutline={() => {
          setOutlineOpen((v) => {
            const next = !v;
            if (next && isCompactScreenNow()) setExplorerOpen(false);
            return next;
          });
        }}
        onToggleZen={() => setZenMode((v) => !v)}
        onNewTab={handleNewTab}
        onOpenFile={() => void handleOpenFile()}
        onOpenFolder={() => void handleOpenFolder()}
        onSave={() => void handleSave(false)}
        onFormat={handleFormatCommand}
        onInsertImage={handleInsertImageRequest}
        onOpenSearch={handleOpenSearch}
        onOpenPalette={() => setPaletteOpen(true)}
        onExportHtml={() => void handleExportHtml()}
        onExportPdf={() => void handleExportPdf()}
        onCopyRichText={() => void handleCopyRichText()}
        onInstallApp={installPrompt ? () => void handleInstallApp() : undefined}
        onExpandSidePanel={() => {
          const url = window.location.href.replace(/[?&]mode=sidepanel/, '');
          window.open(url, '_blank');
        }}
      />

      {!zenMode && (
        <TabBar
          tabs={tabs}
          activeTabId={activeTab.id}
          onSelectTab={handleSelectTab}
          onCloseTab={handleCloseTab}
          onNewTab={handleNewTab}
        />
      )}

      <div className="workspace-body">
        {!zenMode && isCompactViewport && (explorerOpen || outlineOpen) && (
          <div
            className="drawer-backdrop"
            aria-hidden="true"
            onClick={() => {
              setExplorerOpen(false);
              setOutlineOpen(false);
            }}
          />
        )}

        {!zenMode && explorerOpen && (
          <FolderSidebar
            rootName={dirHandle?.name ?? null}
            entries={folderEntries}
            loading={folderLoading}
            needsPermission={folderNeedsPermission}
            readOnly={folderReadOnly}
            activeRelativePath={activeTab.relativePath}
            onOpenFolder={() => void handleOpenFolder()}
            onReconnectFolder={() => void handleReconnectFolder()}
            onRefreshFolder={() => void handleRefreshFolder()}
            onCloseFolder={handleCloseFolder}
            onExpandDirectory={handleExpandDirectory}
            onSelectFile={(entry) => void handleSelectTreeFile(entry)}
            onCreateFile={handleCreateFileInFolder}
          />
        )}

        <main className={`editor-stage mode-${viewMode}`}>
          {viewMode !== 'preview' && (
            <section
              className="editor-pane pane-raw"
              onFocusCapture={() => {
                lastFocusedPaneRef.current = 'raw';
              }}
            >
              <RawEditor
                ref={rawRef}
                docKey={activeTab.id}
                markdown={activeTab.content}
                theme={theme}
                onChange={(next) => updateActiveContent(next, 'raw')}
                onCursorChange={setCursor}
                onScrollRatio={handleRawScrollRatio}
                onSaveShortcut={() => void handleSave(false)}
              />
            </section>
          )}

          {viewMode === 'split' && <div className="split-divider" aria-hidden="true" />}

          {viewMode !== 'raw' && (
            <section
              className="editor-pane pane-preview"
              onFocusCapture={() => {
                lastFocusedPaneRef.current = 'preview';
              }}
            >
              <PreviewEditor
                ref={previewRef}
                docKey={activeTab.id}
                markdown={previewMarkdown}
                theme={theme}
                onChange={(next) => updateActiveContent(next, 'preview')}
                onScrollRatio={handlePreviewScrollRatio}
                onSaveShortcut={() => void handleSave(false)}
                onRequestImageFile={handleInsertImageRequest}
              />
            </section>
          )}
        </main>

        {!zenMode && outlineOpen && (
          <OutlineSidebar headings={headings} onSelectHeading={handleSelectHeading} />
        )}
      </div>

      {!zenMode && (
        <StatusBar
          words={stats.words}
          chars={stats.chars}
          readingMinutes={stats.readingMinutes}
          cursor={cursor}
          viewMode={viewMode}
          isDirty={isDirty}
          hasDiskHandle={Boolean(activeTab.fileHandle)}
          scrollSync={scrollSync}
          onToggleScrollSync={() => setScrollSync((v) => !v)}
          version={updateState.currentVersion}
          hasUpdate={updateState.status === 'update-available'}
          onOpenVersionModal={() => {
            setAboutOpen(true);
            void handleCheckUpdates();
          }}
        />
      )}

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          const input = e.currentTarget as HTMLInputElement;
          const file = input.files?.[0];
          if (file) {
            void handleChosenImageFile(file);
          }
          input.value = '';
        }}
      />

      <CommandPalette
        open={paletteOpen}
        commands={paletteCommands}
        onClose={() => setPaletteOpen(false)}
      />

      <VersionModal
        open={aboutOpen}
        channel={getRuntimeChannel()}
        updateState={updateState}
        onCheckUpdates={() => void handleCheckUpdates()}
        onApplyUpdate={() => void applyPendingUpdate()}
        onClose={() => setAboutOpen(false)}
      />

      {toast && (
        <div className="toast-banner" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
