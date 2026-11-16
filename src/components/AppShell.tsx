import { X } from 'lucide-preact';
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
  consumeExtensionIncomingMarkdown,
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
  readDiskFileIfChanged,
  readFileFromHandle,
  saveDirectoryHandle,
  saveSessionToStorage,
  saveTabToDisk,
  subscribeLaunchQueue,
  updateDirectoryEntry,
  type EditorTab,
  type FolderEntry,
  type LoadedMarkdownFile,
  type PersistedSession,
  type PersistedTabSnapshot,
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
const SIDEPANEL_VIEW_MODE_LS_KEY = 'prismamd.sidepanel.viewMode';
const SIDEPANEL_EXPLORER_LS_KEY = 'prismamd.sidepanel.explorerOpen';
const SIDEPANEL_OUTLINE_LS_KEY = 'prismamd.sidepanel.outlineOpen';
const THEME_LS_KEY = 'prismamd.theme';
const SPLIT_RATIO_LS_KEY = 'prismamd.splitRatio';
const TABS_SYNC_CHANNEL = 'prismamd-tabs-sync';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface DiskConflictState {
  tabId: string;
  tabTitle: string;
  diskContent: string;
  diskLastModified: number;
}

interface TabsBroadcastPayload {
  senderId: string;
  tabs: PersistedTabSnapshot[];
}

function isCompactScreenNow(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(max-width: 768px)').matches;
}

function readDesktopViewMode(): ViewMode {
  const defaultMode: ViewMode = isCompactScreenNow() ? 'preview' : 'split';
  try {
    const saved = localStorage.getItem(VIEW_MODE_LS_KEY);
    return normalizeViewMode(saved, defaultMode);
  } catch {
    return defaultMode;
  }
}

function readInitialViewMode(isSidePanel: boolean): ViewMode {
  if (isSidePanel) {
    try {
      const saved = localStorage.getItem(SIDEPANEL_VIEW_MODE_LS_KEY);
      return normalizeViewMode(saved, 'preview');
    } catch {
      return 'preview';
    }
  }
  return readDesktopViewMode();
}

function readInitialSidePanelFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch {
    // Ignore storage errors
  }
  return fallback;
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

function clampSplitRatio(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(80, Math.max(20, Math.round(value * 10) / 10));
}

function readInitialSplitRatio(): number {
  try {
    const saved = localStorage.getItem(SPLIT_RATIO_LS_KEY);
    if (saved !== null) {
      const parsed = Number.parseFloat(saved);
      if (Number.isFinite(parsed)) {
        return clampSplitRatio(parsed);
      }
    }
  } catch {
    // Ignore storage errors
  }
  return 50;
}

function toTabSnapshots(tabs: EditorTab[]): PersistedTabSnapshot[] {
  return tabs.map((tb) => ({
    id: tb.id,
    title: tb.title,
    content: tb.content,
    savedContent: tb.savedContent,
    isScratchpad: tb.isScratchpad,
    relativePath: tb.isScratchpad ? undefined : tb.relativePath,
    diskLastModified: tb.isScratchpad ? undefined : tb.diskLastModified,
  }));
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
  const [explorerOpen, setExplorerOpenState] = useState<boolean>(() =>
    isSidePanel
      ? readInitialSidePanelFlag(SIDEPANEL_EXPLORER_LS_KEY, false)
      : !isCompactScreenNow(),
  );
  const [outlineOpen, setOutlineOpenState] = useState<boolean>(() =>
    isSidePanel ? readInitialSidePanelFlag(SIDEPANEL_OUTLINE_LS_KEY, false) : false,
  );
  const [splitRatio, setSplitRatio] = useState<number>(() => readInitialSplitRatio());
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const [zenMode, setZenMode] = useState(false);
  const [scrollSync, setScrollSync] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [conflictTab, setConflictTab] = useState<DiskConflictState | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
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
  const editorStageRef = useRef<HTMLElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const syncingScrollFromRef = useRef<'raw' | 'preview' | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const latestTabsRef = useRef<EditorTab[]>(tabs);
  const activeTabIdRef = useRef<string>(activeTabId);
  activeTabIdRef.current = activeTabId;

  const isHydratedRef = useRef(false);
  const sessionSaveTimerRef = useRef<number | null>(null);
  const isPickerActiveRef = useRef(false);
  const osLaunchOccurredRef = useRef(false);
  const openQueueRef = useRef<Promise<void>>(Promise.resolve());
  const tabCursorsRef = useRef<Record<string, { line: number; col: number }>>({
    scratchpad: { line: 1, col: 1 },
  });

  // Preserve desktop layout separately so Side Panel never overwrites desktop viewMode/sidebars
  const desktopLayoutRef = useRef<{
    viewMode: ViewMode;
    explorerOpen: boolean;
    outlineOpen: boolean;
  }>({
    viewMode: readDesktopViewMode(),
    explorerOpen: true,
    outlineOpen: false,
  });

  const themeRef = useRef<ThemeMode>(theme);
  themeRef.current = theme;
  const scrollSyncRef = useRef<boolean>(scrollSync);
  scrollSyncRef.current = scrollSync;
  const tRef = useRef(t);
  tRef.current = t;

  const instanceIdRef = useRef<string>(createTabId());
  const broadcastRef = useRef<BroadcastChannel | null>(null);
  const broadcastTimerRef = useRef<number | null>(null);
  const isApplyingBroadcastRef = useRef(false);

  const commitTabs = useCallback((updater: EditorTab[] | ((prev: EditorTab[]) => EditorTab[])): EditorTab[] => {
    const next = typeof updater === 'function' ? updater(latestTabsRef.current) : updater;
    latestTabsRef.current = next;
    setTabs(next);
    return next;
  }, []);

  const broadcastTabsNow = useCallback((tabsToSend?: EditorTab[]) => {
    if (broadcastTimerRef.current !== null) {
      window.clearTimeout(broadcastTimerRef.current);
      broadcastTimerRef.current = null;
    }
    const channel = broadcastRef.current;
    if (!channel || isApplyingBroadcastRef.current) return;
    try {
      const payload: TabsBroadcastPayload = {
        senderId: instanceIdRef.current,
        tabs: toTabSnapshots(tabsToSend ?? latestTabsRef.current),
      };
      channel.postMessage(payload);
    } catch {
      // Ignore BroadcastChannel errors
    }
  }, []);

  const scheduleTabsBroadcast = useCallback(() => {
    if (!broadcastRef.current || isApplyingBroadcastRef.current) return;
    if (broadcastTimerRef.current !== null) {
      window.clearTimeout(broadcastTimerRef.current);
    }
    broadcastTimerRef.current = window.setTimeout(() => {
      broadcastTimerRef.current = null;
      broadcastTabsNow();
    }, 120);
  }, [broadcastTabsNow]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const setViewMode = useCallback(
    (next: ViewMode) => {
      setViewModeState(next);
      if (isSidePanel) {
        try {
          localStorage.setItem(SIDEPANEL_VIEW_MODE_LS_KEY, next);
        } catch {
          // Ignore
        }
      } else {
        desktopLayoutRef.current = { ...desktopLayoutRef.current, viewMode: next };
        try {
          localStorage.setItem(VIEW_MODE_LS_KEY, next);
        } catch {
          // Ignore
        }
      }
    },
    [isSidePanel],
  );

  const setExplorerOpen = useCallback(
    (updater: boolean | ((prev: boolean) => boolean)) => {
      setExplorerOpenState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        if (isSidePanel) {
          try {
            localStorage.setItem(SIDEPANEL_EXPLORER_LS_KEY, String(next));
          } catch {
            // Ignore
          }
        } else if (!isCompactScreenNow()) {
          desktopLayoutRef.current = { ...desktopLayoutRef.current, explorerOpen: next };
        }
        return next;
      });
    },
    [isSidePanel],
  );

  const setOutlineOpen = useCallback(
    (updater: boolean | ((prev: boolean) => boolean)) => {
      setOutlineOpenState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        if (isSidePanel) {
          try {
            localStorage.setItem(SIDEPANEL_OUTLINE_LS_KEY, String(next));
          } catch {
            // Ignore
          }
        } else if (!isCompactScreenNow()) {
          desktopLayoutRef.current = { ...desktopLayoutRef.current, outlineOpen: next };
        }
        return next;
      });
    },
    [isSidePanel],
  );

  const updateSplitRatio = useCallback((nextValue: number) => {
    const clamped = clampSplitRatio(nextValue);
    setSplitRatio(clamped);
    try {
      localStorage.setItem(SPLIT_RATIO_LS_KEY, String(clamped));
    } catch {
      // Ignore
    }
  }, []);

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next);
    try {
      localStorage.setItem(THEME_LS_KEY, next);
    } catch {
      // Ignore
    }
  }, []);

  const buildPersistedSession = useCallback(
    (tabsList: EditorTab[]): PersistedSession => ({
      tabs: toTabSnapshots(tabsList),
      activeTabId: activeTabIdRef.current,
      viewMode: desktopLayoutRef.current.viewMode,
      theme: themeRef.current,
      explorerOpen: desktopLayoutRef.current.explorerOpen,
      outlineOpen: desktopLayoutRef.current.outlineOpen,
      scrollSync: scrollSyncRef.current,
    }),
    [],
  );

  const flushSessionNow = useCallback((): Promise<void> => {
    if (!isHydratedRef.current) {
      return Promise.resolve();
    }
    if (sessionSaveTimerRef.current !== null) {
      window.clearTimeout(sessionSaveTimerRef.current);
      sessionSaveTimerRef.current = null;
    }
    const currentTabs = latestTabsRef.current;
    return saveSessionToStorage(buildPersistedSession(currentTabs), currentTabs);
  }, [buildPersistedSession]);

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

  // Cross-context BroadcastChannel sync (Full-Tab <-> Side Panel)
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(TABS_SYNC_CHANNEL);
      broadcastRef.current = channel;
      channel.onmessage = (event: MessageEvent<TabsBroadcastPayload>) => {
        const data = event.data;
        if (!data || data.senderId === instanceIdRef.current || !Array.isArray(data.tabs)) {
          return;
        }
        isApplyingBroadcastRef.current = true;
        try {
          lastEditSourceRef.current = 'external';
          commitTabs((current) => {
            const byId = new Map(current.map((tb) => [tb.id, tb]));
            const incomingIds = new Set<string>();
            const merged: EditorTab[] = data.tabs.map((snap) => {
              incomingIds.add(snap.id);
              const existing = byId.get(snap.id);
              if (snap.isScratchpad || snap.id === 'scratchpad') {
                return {
                  id: 'scratchpad',
                  title: existing?.title ?? snap.title,
                  content: snap.content,
                  savedContent: snap.savedContent,
                  isScratchpad: true,
                };
              }
              return {
                ...snap,
                fileHandle: existing?.fileHandle,
              };
            });
            // Preserve any locally-dirty tab not yet known to the sender
            for (const localTab of current) {
              if (!incomingIds.has(localTab.id) && !localTab.isScratchpad && localTab.content !== localTab.savedContent) {
                merged.push(localTab);
              }
            }
            return merged;
          });
        } finally {
          isApplyingBroadcastRef.current = false;
        }
      };
    } catch {
      channel = null;
      broadcastRef.current = null;
    }

    return () => {
      if (broadcastTimerRef.current !== null) {
        window.clearTimeout(broadcastTimerRef.current);
        broadcastTimerRef.current = null;
      }
      broadcastRef.current = null;
      channel?.close();
    };
  }, [commitTabs]);

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

  // Keep previewMarkdown & per-tab cursor aligned on external updates, tab switches, or view mode changes
  useEffect(() => {
    const tabChanged = prevTabIdRef.current !== activeTab.id;
    const viewModeChanged = prevViewModeRef.current !== viewMode;
    prevTabIdRef.current = activeTab.id;
    prevViewModeRef.current = viewMode;

    if (tabChanged) {
      // RawEditor remounts per docKey={activeTab.id} with initial selection at Ln 1, Col 1
      const resetPos =
        viewMode === 'preview'
          ? (tabCursorsRef.current[activeTab.id] ?? { line: 1, col: 1 })
          : { line: 1, col: 1 };
      tabCursorsRef.current[activeTab.id] = resetPos;
      setCursor(resetPos);
    }

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
            fileHandle: undefined,
            relativePath: undefined,
            diskLastModified: undefined,
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

  // External disk modification checker (VS Code-style: silent reload if clean, conflict modal if dirty)
  const checkTabDiskSync = useCallback(
    async (tabId: string): Promise<'unchanged' | 'reloaded' | 'conflict'> => {
      const initialTab = latestTabsRef.current.find((tb) => tb.id === tabId);
      if (!initialTab || initialTab.isScratchpad || !initialTab.fileHandle) {
        return 'unchanged';
      }

      const disk = await readDiskFileIfChanged(initialTab.fileHandle, initialTab.diskLastModified);
      const currentTab = latestTabsRef.current.find((tb) => tb.id === tabId);
      if (!currentTab || currentTab.isScratchpad || !currentTab.fileHandle) {
        return 'unchanged';
      }

      if (!disk.changed || disk.content === undefined) {
        if (disk.lastModified !== undefined && currentTab.diskLastModified === undefined) {
          commitTabs((prev) =>
            prev.map((tb) => (tb.id === tabId ? { ...tb, diskLastModified: disk.lastModified } : tb)),
          );
        }
        return 'unchanged';
      }

      if (disk.content === currentTab.savedContent) {
        if (disk.lastModified !== undefined && currentTab.diskLastModified !== disk.lastModified) {
          commitTabs((prev) =>
            prev.map((tb) => (tb.id === tabId ? { ...tb, diskLastModified: disk.lastModified } : tb)),
          );
        }
        return 'unchanged';
      }

      const tabIsDirty = currentTab.content !== currentTab.savedContent;
      if (!tabIsDirty) {
        lastEditSourceRef.current = 'external';
        const nextTabs = commitTabs((prev) =>
          prev.map((tb) =>
            tb.id === tabId
              ? {
                  ...tb,
                  content: disk.content!,
                  savedContent: disk.content!,
                  diskLastModified: disk.lastModified,
                }
              : tb,
          ),
        );
        broadcastTabsNow(nextTabs);
        showToast(tRef.current.files.reloadedExternalToast.replace('{name}', currentTab.title));
        return 'reloaded';
      }

      setConflictTab({
        tabId: currentTab.id,
        tabTitle: currentTab.title,
        diskContent: disk.content,
        diskLastModified: disk.lastModified ?? Date.now(),
      });
      return 'conflict';
    },
    [broadcastTabsNow, commitTabs, showToast],
  );

  const checkTabDiskSyncRef = useRef(checkTabDiskSync);
  checkTabDiskSyncRef.current = checkTabDiskSync;

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
        broadcastTabsNow(nextTabs);
        if (targetActiveId) {
          setActiveTabId(targetActiveId);
        }
      });

      return openQueueRef.current;
    },
    [broadcastTabsNow, commitTabs],
  );

  // Restore session, directory handle, extension handoffs & PWA launchQueue on boot
  useEffect(() => {
    let active = true;

    const unsubscribeLaunchQueue = subscribeLaunchQueue((files) => {
      osLaunchOccurredRef.current = true;
      void openFilesAsTabs(files);
    });

    async function hydrate() {
      try {
        const [{ session, fileHandles }, savedDir, incomingExt, pendingAppend] = await Promise.all([
          loadSessionFromStorage(),
          loadSavedDirectoryHandle(),
          consumeExtensionIncomingMarkdown(isSidePanel),
          consumePendingScratchpadAppend(),
        ]);

        if (!active) return;

        let mergedRestoredIds: string[] = [];

        if (session && Array.isArray(session.tabs) && session.tabs.length > 0) {
          const restoredTabs: EditorTab[] = session.tabs.map((snap) => {
            if (snap.isScratchpad || snap.id === 'scratchpad') {
              // Sanitize legacy scratchpad: never bind scratchpad to a disk fileHandle
              return {
                id: 'scratchpad',
                title: snap.title || tRef.current.files.scratchpad,
                content: snap.content,
                savedContent: snap.savedContent,
                isScratchpad: true,
                fileHandle: undefined,
                relativePath: undefined,
                diskLastModified: undefined,
              };
            }
            return {
              ...snap,
              fileHandle: fileHandles[snap.id],
            };
          });

          if (!restoredTabs.some((tb) => tb.isScratchpad)) {
            restoredTabs.unshift({
              id: 'scratchpad',
              title: tRef.current.files.scratchpad,
              content: tRef.current.demoMarkdown,
              savedContent: tRef.current.demoMarkdown,
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

          desktopLayoutRef.current = {
            viewMode: normalizeViewMode(session.viewMode),
            explorerOpen: session.explorerOpen,
            outlineOpen: session.outlineOpen,
          };

          lastEditSourceRef.current = 'external';
          const mergedTabs = commitTabs((currentTabs) =>
            mergeRestoredSessionTabs(currentTabs, restoredTabs, duplicateBootTabIds),
          );
          mergedRestoredIds = mergedTabs
            .filter((tb) => !tb.isScratchpad && Boolean(tb.fileHandle))
            .map((tb) => tb.id);

          if (!osLaunchOccurredRef.current && restoredTabs.some((tb) => tb.id === session.activeTabId)) {
            setActiveTabId(session.activeTabId);
          }
          if (!isSidePanel && !isCompactScreenNow()) {
            setViewModeState(desktopLayoutRef.current.viewMode);
            setExplorerOpenState(desktopLayoutRef.current.explorerOpen);
            setOutlineOpenState(desktopLayoutRef.current.outlineOpen);
          } else if (!isSidePanel && isCompactScreenNow()) {
            setExplorerOpenState(false);
            setOutlineOpenState(false);
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
          showToast(tRef.current.files.importedFromViewer);
        }

        // Check restored disk-backed tabs for external edits made while PrismaMD was closed
        for (const tabId of mergedRestoredIds) {
          if (!active) break;
          const res = await checkTabDiskSyncRef.current(tabId);
          if (res === 'conflict') break;
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
      } finally {
        if (active) {
          isHydratedRef.current = true;
          setIsHydrated(true);
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
        const rawIncoming = changes.prismamd_incoming_md.newValue as { targetSurface?: string } | undefined;
        if (isSidePanel && rawIncoming?.targetSurface === 'tab') {
          return;
        }
        void consumeExtensionIncomingMarkdown(isSidePanel).then((payload) => {
          if (payload) {
            void openFilesAsTabs([
              { title: payload.filename, content: payload.content, relativePath: payload.sourceUrl },
            ]);
            showToast(tRef.current.files.importedFromViewer);
          }
        });
      }
      if (changes.prismamd_scratchpad_append?.newValue) {
        void consumePendingScratchpadAppend().then((text) => {
          if (text) {
            lastEditSourceRef.current = 'external';
            const nextTabs = commitTabs((prev) =>
              prev.map((tb) =>
                tb.isScratchpad
                  ? { ...tb, content: `${tb.content.trimEnd()}\n\n> ${text.replace(/\n/g, '\n> ')}\n` }
                  : tb,
              ),
            );
            broadcastTabsNow(nextTabs);
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
  }, [broadcastTabsNow, commitTabs, isSidePanel, openFilesAsTabs, showToast]);

  // Check for external disk edits when window regains focus
  useEffect(() => {
    const onWindowFocus = () => {
      if (!isHydratedRef.current || isPickerActiveRef.current || conflictTab !== null) {
        return;
      }
      const orderedIds = [
        activeTabIdRef.current,
        ...latestTabsRef.current.map((tb) => tb.id).filter((id) => id !== activeTabIdRef.current),
      ];
      void (async () => {
        for (const id of orderedIds) {
          if (isPickerActiveRef.current) break;
          const status = await checkTabDiskSync(id);
          if (status === 'conflict') break;
        }
      })();
    };

    window.addEventListener('focus', onWindowFocus);
    return () => window.removeEventListener('focus', onWindowFocus);
  }, [checkTabDiskSync, conflictTab]);

  // Persist session debounced to IndexedDB (guarded until initial hydration completes)
  useEffect(() => {
    if (!isHydratedRef.current || !isHydrated || isApplyingBroadcastRef.current) {
      return;
    }
    if (sessionSaveTimerRef.current !== null) {
      window.clearTimeout(sessionSaveTimerRef.current);
    }
    sessionSaveTimerRef.current = window.setTimeout(() => {
      sessionSaveTimerRef.current = null;
      void saveSessionToStorage(buildPersistedSession(tabs), tabs);
    }, 350);
    return () => {
      if (sessionSaveTimerRef.current !== null) {
        window.clearTimeout(sessionSaveTimerRef.current);
        sessionSaveTimerRef.current = null;
      }
    };
  }, [isHydrated, tabs, activeTabId, viewMode, theme, explorerOpen, outlineOpen, scrollSync, buildPersistedSession]);

  // Flush pending session state on pagehide / visibilitychange(hidden) & warn on unsaved disk tabs
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isHydratedRef.current) {
        void flushSessionNow();
      }
      const hasDirtyNonScratchpad = latestTabsRef.current.some(
        (tb) => !tb.isScratchpad && tb.content !== tb.savedContent,
      );
      if (hasDirtyNonScratchpad) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    const onPageHide = () => {
      if (isHydratedRef.current) {
        void flushSessionNow();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && isHydratedRef.current) {
        void flushSessionNow();
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [flushSessionNow]);

  const updateActiveContent = useCallback(
    (nextMarkdown: string, source: 'raw' | 'preview') => {
      lastEditSourceRef.current = source;
      commitTabs((prev) =>
        prev.map((tab) => (tab.id === activeTab.id ? { ...tab, content: nextMarkdown } : tab)),
      );
      scheduleTabsBroadcast();

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
    [activeTab.id, commitTabs, scheduleTabsBroadcast],
  );

  const handleCursorChange = useCallback(
    (pos: { line: number; col: number }) => {
      tabCursorsRef.current[activeTab.id] = pos;
      setCursor(pos);
    },
    [activeTab.id],
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
    tabCursorsRef.current[id] = { line: 1, col: 1 };
    lastEditSourceRef.current = 'external';
    const nextTabs = commitTabs((prev) => [...prev, newTab]);
    broadcastTabsNow(nextTabs);
    setActiveTabId(id);
  }, [broadcastTabsNow, commitTabs, t.files.newNote, t.files.untitled]);

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

      delete tabCursorsRef.current[tabId];
      if (conflictTab?.tabId === tabId) {
        setConflictTab(null);
      }
      if (activeTabId === tabId) {
        lastEditSourceRef.current = 'external';
      }
      const nextTabs = commitTabs((prev) => {
        const idx = prev.findIndex((tb) => tb.id === tabId);
        const next = prev.filter((tb) => tb.id !== tabId);
        if (activeTabId === tabId) {
          const fallback = next[Math.max(0, idx - 1)] ?? next[0];
          if (fallback) setActiveTabId(fallback.id);
        }
        return next;
      });
      broadcastTabsNow(nextTabs);
    },
    [activeTabId, broadcastTabsNow, commitTabs, conflictTab?.tabId, t.files.confirmCloseUnsaved],
  );

  const handleOpenFile = useCallback(async () => {
    isPickerActiveRef.current = true;
    try {
      const loaded = await openMarkdownFilesFromPicker();
      await openFilesAsTabs(loaded);
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        showToast(t.files.openErrorToast);
      }
    } finally {
      isPickerActiveRef.current = false;
    }
  }, [openFilesAsTabs, showToast, t.files.openErrorToast]);

  const handleOpenFolder = useCallback(async () => {
    isPickerActiveRef.current = true;
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
      isPickerActiveRef.current = false;
      setFolderLoading(false);
    }
  }, [setExplorerOpen, showToast, t.files.folderErrorToast]);

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
        const loaded = await readFileFromHandle(fileHandle, entry.path);
        await openFilesAsTabs([loaded]);
        if (isCompactScreenNow()) {
          setExplorerOpen(false);
        }
      } catch {
        showToast(t.files.openErrorToast);
      }
    },
    [openFilesAsTabs, setExplorerOpen, showToast, t.files.openErrorToast],
  );

  const handleCreateFileInFolder = useCallback(
    async (filename: string): Promise<boolean> => {
      if (!dirHandle) return false;
      try {
        const created = await createFileInFolder(dirHandle, filename, t.files.defaultNewNoteName);
        await openFilesAsTabs([created]);
        const entries = await readDirectoryChildren(dirHandle);
        setFolderEntries(entries);
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'INVALID_FILENAME') {
          showToast(t.files.invalidFileName);
        } else if (msg.startsWith('FILE_EXISTS:')) {
          const existingName = msg.slice('FILE_EXISTS:'.length);
          showToast(t.files.fileAlreadyExists.replace('{name}', existingName));
        } else {
          showToast(t.files.folderErrorToast);
        }
        return false;
      }
    },
    [
      dirHandle,
      openFilesAsTabs,
      showToast,
      t.files.defaultNewNoteName,
      t.files.fileAlreadyExists,
      t.files.folderErrorToast,
      t.files.invalidFileName,
    ],
  );

  const handleSaveTab = useCallback(
    async (targetTabId: string, forceSaveAs = false, allowOverwriteConflict = false) => {
      const targetTab = latestTabsRef.current.find((tb) => tb.id === targetTabId);
      if (!targetTab) return;

      if (!forceSaveAs && !allowOverwriteConflict && !targetTab.isScratchpad && targetTab.fileHandle) {
        const conflictCheck = await checkTabDiskSync(targetTab.id);
        if (conflictCheck === 'conflict' || conflictCheck === 'reloaded') {
          return;
        }
      }

      const freshTab = latestTabsRef.current.find((tb) => tb.id === targetTabId);
      if (!freshTab) return;

      isPickerActiveRef.current = true;
      try {
        const res = await saveTabToDisk(freshTab, forceSaveAs, t.files.defaultQuickNoteFilename);

        if (freshTab.isScratchpad) {
          // Promote saved Scratchpad content to a dedicated normal file tab and reset Scratchpad
          let matchedExistingId: string | null = null;
          if (res.fileHandle) {
            for (const existing of latestTabsRef.current) {
              if (
                !existing.isScratchpad &&
                existing.fileHandle &&
                (await isSameFileHandle(existing.fileHandle, res.fileHandle))
              ) {
                matchedExistingId = existing.id;
                break;
              }
            }
          }

          const promotedId = matchedExistingId ?? createTabId();
          const savedText = freshTab.content;
          tabCursorsRef.current[promotedId] = { ...(tabCursorsRef.current.scratchpad ?? { line: 1, col: 1 }) };
          tabCursorsRef.current.scratchpad = { line: 1, col: 1 };
          lastEditSourceRef.current = 'external';

          const nextTabs = commitTabs((prev) => {
            const updated = prev.map((tb) => {
              if (tb.isScratchpad) {
                return {
                  id: 'scratchpad',
                  title: t.files.scratchpad,
                  content: t.demoMarkdown,
                  savedContent: t.demoMarkdown,
                  isScratchpad: true,
                  fileHandle: undefined,
                  relativePath: undefined,
                  diskLastModified: undefined,
                };
              }
              if (matchedExistingId && tb.id === matchedExistingId) {
                return {
                  ...tb,
                  title: res.title,
                  content: savedText,
                  savedContent: savedText,
                  fileHandle: res.fileHandle,
                  diskLastModified: res.lastModified,
                };
              }
              return tb;
            });

            if (!matchedExistingId) {
              updated.push({
                id: promotedId,
                title: res.title,
                content: savedText,
                savedContent: savedText,
                isScratchpad: false,
                fileHandle: res.fileHandle,
                diskLastModified: res.lastModified,
              });
            }
            return updated;
          });

          broadcastTabsNow(nextTabs);
          setActiveTabId(promotedId);
        } else {
          const nextTabs = commitTabs((prev) =>
            prev.map((tab) =>
              tab.id === freshTab.id
                ? {
                    ...tab,
                    title: res.title,
                    fileHandle: res.fileHandle ?? (forceSaveAs ? undefined : tab.fileHandle),
                    savedContent: tab.content,
                    diskLastModified: res.lastModified,
                  }
                : tab,
            ),
          );
          broadcastTabsNow(nextTabs);
        }

        if (res.usedFallbackSaveAs) {
          showToast(t.files.readOnlyFallbackSaveAs);
        } else {
          showToast(formatMessage(t.files.savedToast, { name: res.title }));
        }

        if (dirHandle) {
          void handleRefreshFolder();
        }
      } catch (err) {
        if ((err as { name?: string })?.name !== 'AbortError') {
          showToast(t.files.saveErrorToast);
        }
      } finally {
        isPickerActiveRef.current = false;
      }
    },
    [
      broadcastTabsNow,
      checkTabDiskSync,
      commitTabs,
      dirHandle,
      handleRefreshFolder,
      showToast,
      t.demoMarkdown,
      t.files.defaultQuickNoteFilename,
      t.files.readOnlyFallbackSaveAs,
      t.files.saveErrorToast,
      t.files.savedToast,
      t.files.scratchpad,
    ],
  );

  const handleSave = useCallback(
    async (forceSaveAs = false) => {
      await handleSaveTab(activeTab.id, forceSaveAs, false);
    },
    [activeTab.id, handleSaveTab],
  );

  const handleConflictReload = useCallback(async () => {
    if (!conflictTab) return;
    const target = latestTabsRef.current.find((tb) => tb.id === conflictTab.tabId);
    let nextContent = conflictTab.diskContent;
    let nextLastModified = conflictTab.diskLastModified;

    if (target?.fileHandle) {
      const freshDisk = await readDiskFileIfChanged(target.fileHandle);
      if (freshDisk.changed && freshDisk.content !== undefined) {
        nextContent = freshDisk.content;
        if (freshDisk.lastModified !== undefined) {
          nextLastModified = freshDisk.lastModified;
        }
      }
    }

    const title = target?.title ?? conflictTab.tabTitle;
    setConflictTab(null);
    lastEditSourceRef.current = 'external';
    const nextTabs = commitTabs((prev) =>
      prev.map((tb) =>
        tb.id === conflictTab.tabId
          ? {
              ...tb,
              content: nextContent,
              savedContent: nextContent,
              diskLastModified: nextLastModified,
            }
          : tb,
      ),
    );
    broadcastTabsNow(nextTabs);
    showToast(t.files.reloadedExternalToast.replace('{name}', title));
  }, [broadcastTabsNow, commitTabs, conflictTab, showToast, t.files.reloadedExternalToast]);

  const handleConflictOverwrite = useCallback(() => {
    if (!conflictTab) return;
    const targetId = conflictTab.tabId;
    setConflictTab(null);
    void handleSaveTab(targetId, false, true);
  }, [conflictTab, handleSaveTab]);

  const handleConflictSaveCopy = useCallback(() => {
    if (!conflictTab) return;
    const targetId = conflictTab.tabId;
    setConflictTab(null);
    void handleSaveTab(targetId, true, true);
  }, [conflictTab, handleSaveTab]);

  const handleFormatCommand = useCallback(
    (cmd: FormatCommand) => {
      const useRaw =
        viewMode === 'raw' || (viewMode === 'split' && lastFocusedPaneRef.current === 'raw');

      if (useRaw && rawRef.current) {
        const colWord = locale.toLowerCase().startsWith('en') ? 'Column' : 'Columna';
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
              `\n| ${colWord} 1 | ${colWord} 2 | ${colWord} 3 |\n| :--- | :---: | ---: |\n| A | B | C |\n`,
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
    [locale, viewMode],
  );

  const handleInsertImageRequest = useCallback(() => {
    imageInputRef.current?.click();
  }, []);

  const handleImages = useCallback(
    async (files: Iterable<File>, insertPos?: number) => {
      const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (imageFiles.length === 0) return;

      const useRaw =
        viewMode === 'raw' || (viewMode === 'split' && lastFocusedPaneRef.current === 'raw');

      try {
        if (useRaw && rawRef.current) {
          const snippets: string[] = [];
          for (const file of imageFiles) {
            const res = await fileToMarkdownImage(file, t.toolbar.defaultImageAlt);
            snippets.push(res.markdown);
          }
          // Insert sequentially advancing position in natural order
          if (typeof insertPos === 'number') {
            let cursorOffset = insertPos;
            for (const md of snippets) {
              const chunk = `\n${md}\n`;
              rawRef.current.insertSnippet(chunk);
              cursorOffset += chunk.length;
            }
            void cursorOffset;
          } else if (snippets.length > 0) {
            rawRef.current.insertSnippet(`\n${snippets.join('\n')}\n`);
          }
        } else if (previewRef.current) {
          for (const file of imageFiles) {
            await previewRef.current.insertImageFromFile(file);
          }
        }
      } catch {
        showToast(t.files.imageLoadErrorToast);
      }
    },
    [showToast, t.files.imageLoadErrorToast, t.toolbar.defaultImageAlt, viewMode],
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
    await exportStandaloneHtml(activeTab.title, activeTab.content, theme, {
      locale,
      defaultDocFilename: t.files.defaultDocFilename,
    });
    showToast(t.exportMenu.exportedHtml);
  }, [
    activeTab.content,
    activeTab.title,
    locale,
    showToast,
    t.exportMenu.exportedHtml,
    t.files.defaultDocFilename,
    theme,
  ]);

  const handleExportPdf = useCallback(async () => {
    await exportPrintPdf(activeTab.title, activeTab.content, theme, {
      locale,
      defaultDocFilename: t.files.defaultDocFilename,
    });
  }, [activeTab.content, activeTab.title, locale, t.files.defaultDocFilename, theme]);

  const handleCopyRichText = useCallback(async () => {
    try {
      await copyAsRichText(activeTab.content, theme);
      showToast(t.exportMenu.copiedRichText);
    } catch {
      showToast(t.exportMenu.copyError);
    }
  }, [activeTab.content, theme, showToast, t.exportMenu.copiedRichText, t.exportMenu.copyError]);

  const handleExpandSidePanel = useCallback(async () => {
    broadcastTabsNow();
    await flushSessionNow();
    const parsedUrl = new URL(window.location.href);
    parsedUrl.searchParams.delete('mode');
    const targetUrl = parsedUrl.toString();
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url: targetUrl }).catch(() => {
        window.open(targetUrl, '_blank');
      });
    } else {
      window.open(targetUrl, '_blank');
    }
  }, [broadcastTabsNow, flushSessionNow]);

  // Close conflict modal on Escape without letting Escape bubble to Zen Mode
  useEffect(() => {
    if (!conflictTab) return;
    const onConflictKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setConflictTab(null);
      }
    };
    window.addEventListener('keydown', onConflictKey, true);
    return () => window.removeEventListener('keydown', onConflictKey, true);
  }, [conflictTab]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;

      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && e.shiftKey && !e.altKey && key === 'p') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && key === 'z') {
        e.preventDefault();
        setZenMode((v) => !v);
        return;
      }
      if (mod && !e.altKey && key === 's') {
        e.preventDefault();
        void handleSave(e.shiftKey);
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && key === 'o') {
        e.preventDefault();
        void handleOpenFile();
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && key === 'p') {
        e.preventDefault();
        void handleExportPdf();
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && key === 'f' && viewMode === 'preview') {
        e.preventDefault();
        handleOpenSearch();
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && e.key === '1') {
        e.preventDefault();
        setViewMode('raw');
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && e.key === '2') {
        e.preventDefault();
        setViewMode('split');
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && e.key === '3') {
        e.preventDefault();
        setViewMode('preview');
        return;
      }
      if (
        e.key === 'Escape' &&
        zenMode &&
        !paletteOpen &&
        !aboutOpen &&
        conflictTab === null
      ) {
        setZenMode(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    aboutOpen,
    conflictTab,
    handleExportPdf,
    handleOpenFile,
    handleOpenSearch,
    handleSave,
    paletteOpen,
    setViewMode,
    viewMode,
    zenMode,
  ]);

  // Prevent stray margin file drops from navigating the browser tab away
  useEffect(() => {
    const onWinDragOver = (e: DragEvent) => {
      const hasFiles = Boolean(
        (e.dataTransfer?.files && e.dataTransfer.files.length > 0) ||
          e.dataTransfer?.types?.includes('Files'),
      );
      if (hasFiles) {
        e.preventDefault();
      }
    };
    const onWinDrop = (e: DragEvent) => {
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        e.preventDefault();
      }
    };
    window.addEventListener('dragover', onWinDragOver);
    window.addEventListener('drop', onWinDrop);
    return () => {
      window.removeEventListener('dragover', onWinDragOver);
      window.removeEventListener('drop', onWinDrop);
    };
  }, []);

  // Debounced Outline AST extraction (150ms during rapid typing; immediate on tab switch / opening Outline)
  const [headings, setHeadings] = useState<OutlineHeading[]>(() =>
    outlineOpen ? extractHeadingsOutline(activeTab.content) : [],
  );
  const outlineTimerRef = useRef<number | null>(null);
  const prevOutlineTabIdRef = useRef<string>(activeTab.id);
  const prevOutlineOpenRef = useRef<boolean>(outlineOpen);

  useEffect(() => {
    if (outlineTimerRef.current !== null) {
      window.clearTimeout(outlineTimerRef.current);
      outlineTimerRef.current = null;
    }

    const tabSwitched = prevOutlineTabIdRef.current !== activeTab.id;
    const justOpened = outlineOpen && !prevOutlineOpenRef.current;
    prevOutlineTabIdRef.current = activeTab.id;
    prevOutlineOpenRef.current = outlineOpen;

    if (!outlineOpen) {
      return;
    }

    if (tabSwitched || justOpened) {
      setHeadings(extractHeadingsOutline(activeTab.content));
      return;
    }

    outlineTimerRef.current = window.setTimeout(() => {
      outlineTimerRef.current = null;
      setHeadings(extractHeadingsOutline(activeTab.content));
    }, 150);

    return () => {
      if (outlineTimerRef.current !== null) {
        window.clearTimeout(outlineTimerRef.current);
        outlineTimerRef.current = null;
      }
    };
  }, [activeTab.id, activeTab.content, outlineOpen]);

  const stats = useMemo(() => computeDocumentStats(activeTab.content), [activeTab.content]);

  const handleSelectHeading = useCallback(
    (heading: OutlineHeading, index: number) => {
      rawRef.current?.scrollToLine(heading.line);
      previewRef.current?.scrollToHeading(index, heading.text);
      if (isCompactScreenNow()) {
        setOutlineOpen(false);
      }
    },
    [setOutlineOpen],
  );

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

  const handleSplitPointerDown = useCallback(
    (e: PointerEvent) => {
      if (e.button !== 0) return;
      const stage = editorStageRef.current;
      if (!stage) return;
      e.preventDefault();
      setIsDraggingSplit(true);
      const target = e.currentTarget as HTMLElement | null;
      try {
        target?.setPointerCapture?.(e.pointerId);
      } catch {
        // Ignore when pointerId is synthetic
      }

      const onPointerMove = (moveEvent: PointerEvent) => {
        const rect = stage.getBoundingClientRect();
        if (rect.width <= 0) return;
        const pct = ((moveEvent.clientX - rect.left) / rect.width) * 100;
        updateSplitRatio(pct);
      };

      const finishDrag = () => {
        setIsDraggingSplit(false);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', finishDrag);
        window.removeEventListener('pointercancel', finishDrag);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', finishDrag);
      window.addEventListener('pointercancel', finishDrag);
    },
    [updateSplitRatio],
  );

  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    const cmds: PaletteCommand[] = [
      { id: 'view-raw', category: t.palette.categories.view, title: t.views.raw, shortcut: 'Ctrl+1', run: () => setViewMode('raw') },
      { id: 'view-split', category: t.palette.categories.view, title: t.views.split, shortcut: 'Ctrl+2', run: () => setViewMode('split') },
      { id: 'view-preview', category: t.palette.categories.view, title: t.views.preview, shortcut: 'Ctrl+3', run: () => setViewMode('preview') },
      { id: 'view-zen', category: t.palette.categories.view, title: t.toolbar.zenMode, shortcut: 'Alt+Z', run: () => setZenMode((v) => !v) },
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
      { id: 'exp-pdf', category: t.palette.categories.export, title: t.exportMenu.exportPdf, shortcut: 'Ctrl+P', run: () => void handleExportPdf() },
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
    setExplorerOpen,
    setOutlineOpen,
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
    const alreadyHandledByEditor = e.defaultPrevented;
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    e.preventDefault();

    if (alreadyHandledByEditor) {
      return;
    }

    const fileArray = Array.from(files);
    const mdFiles = fileArray.filter((f) => isMarkdownFilename(f.name));
    if (mdFiles.length > 0) {
      const loaded = await Promise.all(
        mdFiles.map(async (f) => ({
          title: f.name,
          content: await f.text(),
          lastModified: f.lastModified,
        })),
      );
      await openFilesAsTabs(loaded);
      return;
    }

    const imageFiles = fileArray.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length > 0) {
      await handleImages(imageFiles);
    }
  };

  return (
    <div
      className={`app-shell ${zenMode ? 'zen-mode' : ''} ${isSidePanel ? 'sidepanel-mode' : ''}`}
      data-theme={theme}
      onDragOver={(e) => {
        if (
          (e.dataTransfer?.files && e.dataTransfer.files.length > 0) ||
          e.dataTransfer?.types?.includes('Files')
        ) {
          e.preventDefault();
        }
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
        onExpandSidePanel={() => void handleExpandSidePanel()}
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

        <main
          ref={editorStageRef}
          className={`editor-stage mode-${viewMode}`}
          style={{ '--split-ratio': `${splitRatio}%` } as Record<string, string>}
        >
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
                onCursorChange={handleCursorChange}
                onScrollRatio={handleRawScrollRatio}
                onSaveShortcut={() => void handleSave(false)}
              />
            </section>
          )}

          {viewMode === 'split' && (
            <div
              className={`split-divider ${isDraggingSplit ? 'dragging' : ''}`}
              role="separator"
              aria-orientation="vertical"
              aria-label={t.views.splitResizeAria}
              aria-valuenow={Math.round(splitRatio)}
              aria-valuemin={20}
              aria-valuemax={80}
              tabIndex={0}
              onPointerDown={handleSplitPointerDown}
              onDblClick={() => updateSplitRatio(50)}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 10 : 2;
                if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  updateSplitRatio(splitRatio - step);
                } else if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  updateSplitRatio(splitRatio + step);
                } else if (e.key === 'Home') {
                  e.preventDefault();
                  updateSplitRatio(20);
                } else if (e.key === 'End') {
                  e.preventDefault();
                  updateSplitRatio(80);
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  updateSplitRatio(50);
                }
              }}
            />
          )}

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
        multiple
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          const input = e.currentTarget as HTMLInputElement;
          const files = input.files ? Array.from(input.files) : [];
          if (files.length > 0) {
            void handleImages(files);
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

      {conflictTab && (
        <div
          className="version-modal-backdrop modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConflictTab(null);
          }}
        >
          <div
            className="version-modal conflict-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="prismamd-conflict-title"
          >
            <div className="version-modal-header">
              <div className="version-modal-title-wrap">
                <span className="brand-mark">◆</span>
                <h2 id="prismamd-conflict-title" className="version-modal-title">
                  {t.files.diskConflictTitle}
                </h2>
              </div>
              <button
                type="button"
                className="tab-close-btn"
                onClick={() => setConflictTab(null)}
                aria-label={t.about.close}
                title={t.about.close}
              >
                <X size={15} />
              </button>
            </div>
            <div className="version-modal-body">
              <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                {t.files.diskConflictDesc.replace('{name}', conflictTab.tabTitle)}
              </p>
              <div className="conflict-modal-actions">
                <button
                  type="button"
                  className="version-btn secondary"
                  onClick={() => void handleConflictReload()}
                >
                  {t.files.reloadFromDisk}
                </button>
                <button
                  type="button"
                  className="version-btn secondary"
                  onClick={handleConflictSaveCopy}
                >
                  {t.files.saveAsCopy}
                </button>
                <button
                  type="button"
                  className="version-btn primary"
                  onClick={handleConflictOverwrite}
                >
                  {t.files.overwriteDisk}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast-banner" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
