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
import { useEffect, useMemo, useState } from 'preact/hooks';
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
  onCreateFile: (filename: string) => Promise<void>;
}

function TreeNode({
  entry,
  depth,
  forceExpanded,
  activeRelativePath,
  onExpandDirectory,
  onSelectFile,
}: {
  entry: FolderEntry;
  depth: number;
  forceExpanded: boolean;
  activeRelativePath?: string;
  onExpandDirectory: (entry: FolderEntry) => Promise<void>;
  onSelectFile: (entry: FolderEntry) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const isOpen = forceExpanded || expanded;

  if (entry.kind === 'directory') {
    const toggleDir = () => {
      const next = !expanded;
      setExpanded(next);
      if (next && !entry.loaded && !entry.loading) {
        void onExpandDirectory(entry);
      }
    };

    const children = entry.children ?? [];

    return (
      <div className="tree-node">
        <button
          type="button"
          className="tree-row tree-dir"
          style={{ paddingLeft: `${10 + depth * 12}px` }}
          onClick={toggleDir}
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
                  activeRelativePath={activeRelativePath}
                  onExpandDirectory={onExpandDirectory}
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

  useEffect(() => {
    setFilter('');
    setCreating(false);
    setNewName('');
  }, [rootName]);

  const trimmedFilter = filter.trim();
  const visibleEntries = useMemo(() => filterTree(entries, trimmedFilter), [entries, trimmedFilter]);

  const submitCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      setCreating(false);
      return;
    }
    await onCreateFile(trimmed);
    setNewName('');
    setCreating(false);
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
              RO
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
                value={newName}
                placeholder={t.files.newFilePlaceholder}
                onInput={(e) => setNewName((e.currentTarget as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitCreate();
                  else if (e.key === 'Escape') setCreating(false);
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
                  activeRelativePath={activeRelativePath}
                  onExpandDirectory={onExpandDirectory}
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
