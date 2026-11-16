import {
  ChevronDown,
  ChevronRight,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
  X,
} from 'lucide-preact';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { useI18n } from '../i18n';
import type { FolderEntry } from '../workspace/fileSystem';

interface FolderSidebarProps {
  rootName: string | null;
  entries: FolderEntry[];
  loading: boolean;
  needsPermission: boolean;
  readOnly: boolean;
  activeRelativePath?: string;
  onOpenFolder: () => void;
  onReconnectFolder: () => void;
  onRefreshFolder: () => void;
  onCloseFolder: () => void;
  onExpandDirectory: (entry: FolderEntry) => Promise<void>;
  onSelectFile: (entry: FolderEntry) => void;
  onCreateFile: (filename: string) => Promise<boolean | void>;
}

function TreeNode({
  entry,
  depth,
  forceExpanded,
  expandedPaths,
  activeRelativePath,
  onToggleDirectory,
  onSelectFile,
}: {
  entry: FolderEntry;
  depth: number;
  forceExpanded: boolean;
  expandedPaths: ReadonlySet<string>;
  activeRelativePath?: string;
  onToggleDirectory: (entry: FolderEntry) => void;
  onSelectFile: (entry: FolderEntry) => void;
}) {
  const { t } = useI18n();
  const isOpen = forceExpanded || expandedPaths.has(entry.path);

  if (entry.kind === 'directory') {
    const children = entry.children ?? [];

    return (
      <div className="tree-node">
        <button
          type="button"
          className="tree-row tree-dir"
          aria-expanded={isOpen}
          style={{ paddingLeft: `${10 + depth * 12}px` }}
          onClick={() => onToggleDirectory(entry)}
        >
          {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Folder size={13} />
          <span className="tree-name">{entry.name}</span>
          {entry.loading && <span className="tree-loading-dot">…</span>}
        </button>
        {isOpen && (
          <>
            {entry.loading && children.length === 0 ? (
              <div className="tree-empty-hint" style={{ paddingLeft: `${24 + (depth + 1) * 12}px` }}>
                {t.files.loadingFolder}
              </div>
            ) : entry.loaded && children.length === 0 ? (
              <div className="tree-empty-hint" style={{ paddingLeft: `${24 + (depth + 1) * 12}px` }}>
                {t.files.emptySubfolder}
              </div>
            ) : (
              children.map((child) => (
                <TreeNode
                  key={child.path}
                  entry={child}
                  depth={depth + 1}
                  forceExpanded={forceExpanded}
                  expandedPaths={expandedPaths}
                  activeRelativePath={activeRelativePath}
                  onToggleDirectory={onToggleDirectory}
                  onSelectFile={onSelectFile}
                />
              ))
            )}
          </>
        )}
      </div>
    );
  }

  const isActive = activeRelativePath === entry.path;
  return (
    <button
      type="button"
      className={`tree-row tree-file ${isActive ? 'active' : ''}`}
      style={{ paddingLeft: `${24 + depth * 12}px` }}
      onClick={() => onSelectFile(entry)}
      title={entry.path}
    >
      <FileText size={13} />
      <span className="tree-name">{entry.name}</span>
    </button>
  );
}

function collectUnloadedExpandedDirectories(
  list: FolderEntry[],
  expandedPaths: ReadonlySet<string>,
  out: FolderEntry[] = [],
): FolderEntry[] {
  for (const entry of list) {
    if (entry.kind !== 'directory') continue;
    if (!expandedPaths.has(entry.path)) continue;
    if (!entry.loaded && !entry.loading) {
      out.push(entry);
    } else if (entry.children && entry.children.length > 0) {
      collectUnloadedExpandedDirectories(entry.children, expandedPaths, out);
    }
  }
  return out;
}

function filterTree(entries: FolderEntry[], query: string): FolderEntry[] {
  if (!query) return entries;
  const q = query.toLowerCase();
  const out: FolderEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === 'file') {
      if (entry.name.toLowerCase().includes(q) || entry.path.toLowerCase().includes(q)) {
        out.push(entry);
      }
    } else {
      const sub = entry.children ? filterTree(entry.children, q) : [];
      if (sub.length > 0 || entry.name.toLowerCase().includes(q)) {
        out.push({ ...entry, children: sub });
      }
    }
  }
  return out;
}

export function FolderSidebar({
  rootName,
  entries,
  loading,
  needsPermission,
  readOnly,
  activeRelativePath,
  onOpenFolder,
  onReconnectFolder,
  onRefreshFolder,
  onCloseFolder,
  onExpandDirectory,
  onSelectFile,
  onCreateFile,
}: FolderSidebarProps) {
  const { t } = useI18n();
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [submittingCreate, setSubmittingCreate] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setFilter('');
    setCreating(false);
    setNewName('');
    setExpandedPaths(new Set());
  }, [rootName]);

  useEffect(() => {
    if (expandedPaths.size === 0 || entries.length === 0) return;
    const toLoad = collectUnloadedExpandedDirectories(entries, expandedPaths);
    for (const dirEntry of toLoad) {
      void onExpandDirectory(dirEntry);
    }
  }, [entries, expandedPaths, onExpandDirectory]);

  const handleToggleDirectory = useCallback(
    (entry: FolderEntry) => {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(entry.path)) {
          next.delete(entry.path);
        } else {
          next.add(entry.path);
        }
        return next;
      });
      if (!entry.loaded && !entry.loading && filter.trim().length > 0) {
        void onExpandDirectory(entry);
      }
    },
    [filter, onExpandDirectory],
  );

  const trimmedFilter = filter.trim();
  const visibleEntries = useMemo(() => filterTree(entries, trimmedFilter), [entries, trimmedFilter]);

  const submitCreate = async () => {
    if (submittingCreate) return;
    const trimmed = newName.trim();
    if (!trimmed) {
      setCreating(false);
      return;
    }
    setSubmittingCreate(true);
    try {
      const ok = await onCreateFile(trimmed);
      if (ok !== false) {
        setNewName('');
        setCreating(false);
      }
    } catch {
      // Keep input open so user can adjust the filename; AppShell shows the localized toast
    } finally {
      setSubmittingCreate(false);
    }
  };

  return (
    <aside className="sidebar sidebar-left" aria-label={t.sidebars.explorer}>
      <div className="sidebar-header">
        <div className="sidebar-title-wrap">
          <span className="sidebar-title" title={rootName ?? t.sidebars.explorer}>
            {rootName ?? t.sidebars.explorer}
          </span>
          {rootName && readOnly && (
            <span className="folder-ro-badge" title={t.files.readOnlyFolder}>
              {t.files.readOnlyBadge}
            </span>
          )}
        </div>
        <div className="sidebar-actions">
          {rootName && !needsPermission && (
            <>
              {!readOnly && (
                <button
                  type="button"
                  className="icon-mini-btn"
                  onClick={() => setCreating((v) => !v)}
                  title={t.files.newFileInFolder}
                >
                  <FilePlus size={14} />
                </button>
              )}
              <button
                type="button"
                className="icon-mini-btn"
                onClick={onRefreshFolder}
                title={t.files.refreshFolder}
              >
                <RefreshCw size={13} />
              </button>
            </>
          )}
          <button
            type="button"
            className="icon-mini-btn"
            onClick={onOpenFolder}
            title={t.files.openFolder}
          >
            <FolderOpen size={14} />
          </button>
          {rootName && (
            <button
              type="button"
              className="icon-mini-btn"
              onClick={onCloseFolder}
              title={t.files.closeFolder}
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {needsPermission ? (
        <div className="sidebar-empty">
          <p>{t.files.reconnectFolder}</p>
          <button type="button" className="primary-mini-btn" onClick={onReconnectFolder}>
            {t.files.reconnectFolderAction}
          </button>
        </div>
      ) : !rootName ? (
        <div className="sidebar-empty">
          <p>{t.files.openFolderHint}</p>
          <button type="button" className="primary-mini-btn" onClick={onOpenFolder}>
            <FolderOpen size={14} />
            <span>{t.files.openFolder}</span>
          </button>
        </div>
      ) : (
        <>
          <div className="sidebar-search">
            <input
              type="search"
              className="sidebar-input"
              value={filter}
              placeholder={t.files.filterFiles}
              onInput={(e) => setFilter((e.currentTarget as HTMLInputElement).value)}
            />
          </div>

          {creating && !readOnly && (
            <div className="sidebar-new-file">
              <input
                type="text"
                className="sidebar-input"
                autoFocus
                disabled={submittingCreate}
                value={newName}
                placeholder={t.files.newFilePlaceholder}
                onInput={(e) => setNewName((e.currentTarget as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void submitCreate();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setCreating(false);
                  }
                }}
              />
            </div>
          )}

          <div className="sidebar-tree">
            {loading ? (
              <div className="sidebar-empty-muted">{t.files.loadingFolder}</div>
            ) : visibleEntries.length === 0 ? (
              <div className="sidebar-empty-muted">{t.files.emptyFolder}</div>
            ) : (
              visibleEntries.map((entry) => (
                <TreeNode
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  forceExpanded={trimmedFilter.length > 0}
                  expandedPaths={expandedPaths}
                  activeRelativePath={activeRelativePath}
                  onToggleDirectory={handleToggleDirectory}
                  onSelectFile={onSelectFile}
                />
              ))
            )}
          </div>
        </>
      )}
    </aside>
  );
}
