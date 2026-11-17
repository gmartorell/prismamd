import {
  AlertTriangle,
  Bold,
  BookOpen,
  Code,
  Columns2,
  Command,
  Copy,
  Download,
  Eye,
  FileCode2,
  FilePlus,
  FileText,
  FolderOpen,
  GitBranch,
  Image as ImageIcon,
  Info,
  Italic,
  ListTodo,
  Maximize2,
  Minimize2,
  MonitorDown,
  Moon,
  PanelLeft,
  PanelRight,
  Printer,
  Save,
  Search,
  Sigma,
  Sun,
  Table,
} from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useI18n } from '../i18n';
import type { ThemeMode } from '../renderers/mermaidRenderer';
import type { ViewMode } from '../workspace/fileSystem';

export type FormatCommand =
  | 'bold'
  | 'italic'
  | 'code'
  | 'taskList'
  | 'table'
  | 'mermaid'
  | 'mathInline'
  | 'mathBlock'
  | 'alert';

interface TopToolbarProps {
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  theme: ThemeMode;
  onChangeTheme: (theme: ThemeMode) => void;
  isDirty: boolean;
  isSidePanel: boolean;
  explorerOpen: boolean;
  outlineOpen: boolean;
  zenMode: boolean;
  onToggleExplorer: () => void;
  onToggleOutline: () => void;
  onToggleZen: () => void;
  onNewTab: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onSave: () => void;
  onFormat: (cmd: FormatCommand) => void;
  onInsertImage: () => void;
  onOpenSearch: () => void;
  onOpenPalette: () => void;
  onExportHtml: () => void;
  onExportPdf: () => void;
  onCopyRichText: () => void;
  onInstallApp?: () => void;
  onExpandSidePanel?: () => void;
  onOpenAbout?: () => void;
}

export function TopToolbar({
  viewMode,
  onChangeViewMode,
  theme,
  onChangeTheme,
  isDirty,
  isSidePanel,
  explorerOpen,
  outlineOpen,
  zenMode,
  onToggleExplorer,
  onToggleOutline,
  onToggleZen,
  onNewTab,
  onOpenFile,
  onOpenFolder,
  onSave,
  onFormat,
  onInsertImage,
  onOpenSearch,
  onOpenPalette,
  onExportHtml,
  onExportPdf,
  onCopyRichText,
  onInstallApp,
  onExpandSidePanel,
  onOpenAbout,
}: TopToolbarProps) {
  const { locale, t, availableLocales, setLocale } = useI18n();
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const exportBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!exportOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setExportOpen(false);
        exportBtnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [exportOpen]);

  if (zenMode) {
    return (
      <button
        type="button"
        className="zen-exit-fab"
        onClick={onToggleZen}
        title={t.toolbar.exitZen}
      >
        <Minimize2 size={15} />
        <span>{t.toolbar.exitZen}</span>
      </button>
    );
  }

  return (
    <header className={`top-toolbar ${isSidePanel ? 'compact' : ''}`}>
      <div className="toolbar-group toolbar-left">
        <div className="brand-badge" title={t.appName}>
          <span className="brand-mark">◆</span>
          {!isSidePanel && <span className="brand-name">{t.appName}</span>}
        </div>

        <button
          type="button"
          className={`tool-btn ${explorerOpen ? 'active' : ''}`}
          onClick={onToggleExplorer}
          title={t.sidebars.toggleExplorer}
        >
          <PanelLeft size={16} />
        </button>

        <button type="button" className="tool-btn" onClick={onNewTab} title={t.files.newNote}>
          <FilePlus size={16} />
        </button>

        <button type="button" className="tool-btn" onClick={onOpenFile} title={`${t.files.openFile} (Ctrl+O)`}>
          <FileText size={16} />
        </button>

        {!isSidePanel && (
          <button
            type="button"
            className="tool-btn hide-mobile-xs"
            onClick={onOpenFolder}
            title={t.files.openFolder}
          >
            <FolderOpen size={16} />
          </button>
        )}

        <button
          type="button"
          className={`tool-btn save-btn ${isDirty ? 'dirty' : ''}`}
          onClick={onSave}
          title={`${t.files.save} (Ctrl+S)`}
        >
          <Save size={16} />
          {!isSidePanel && <span className="save-label">{t.files.save}</span>}
          {isDirty && <span className="dirty-indicator" aria-label={t.files.unsavedDot} />}
        </button>
      </div>

      <div className="toolbar-group toolbar-center">
        <div className="view-switcher" role="tablist" aria-label={t.views.viewModeAria}>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'raw'}
            data-testid="view-raw"
            className={`view-tab ${viewMode === 'raw' ? 'active' : ''}`}
            onClick={() => onChangeViewMode('raw')}
            title={`${t.views.raw} (Ctrl+1)`}
          >
            <FileCode2 size={14} />
            <span>{t.views.rawShort}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'split'}
            data-testid="view-split"
            className={`view-tab ${viewMode === 'split' ? 'active' : ''}`}
            onClick={() => onChangeViewMode('split')}
            title={`${t.views.split} (Ctrl+2)`}
          >
            <Columns2 size={14} />
            <span>{t.views.splitShort}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'preview'}
            data-testid="view-preview"
            className={`view-tab ${viewMode === 'preview' ? 'active' : ''}`}
            onClick={() => onChangeViewMode('preview')}
            title={`${t.views.preview} (Ctrl+3)`}
          >
            <Eye size={14} />
            <span>{t.views.previewShort}</span>
          </button>
        </div>

        {!isSidePanel && (
          <div className="format-strip">
            <button type="button" className="tool-btn" onClick={() => onFormat('bold')} title={t.toolbar.bold}>
              <Bold size={15} />
            </button>
            <button type="button" className="tool-btn" onClick={() => onFormat('italic')} title={t.toolbar.italic}>
              <Italic size={15} />
            </button>
            <button type="button" className="tool-btn" onClick={() => onFormat('code')} title={t.toolbar.inlineCode}>
              <Code size={15} />
            </button>
            <button type="button" className="tool-btn" onClick={() => onFormat('taskList')} title={t.toolbar.taskList}>
              <ListTodo size={15} />
            </button>
            <button type="button" className="tool-btn" onClick={() => onFormat('table')} title={t.toolbar.table}>
              <Table size={15} />
            </button>
            <button type="button" className="tool-btn" onClick={() => onFormat('mermaid')} title={t.toolbar.mermaid}>
              <GitBranch size={15} />
            </button>
            <button type="button" className="tool-btn" onClick={() => onFormat('mathBlock')} title={t.toolbar.mathBlock}>
              <Sigma size={15} />
            </button>
            <button type="button" className="tool-btn" onClick={() => onFormat('alert')} title={t.toolbar.alert}>
              <AlertTriangle size={15} />
            </button>
            <button type="button" className="tool-btn" onClick={onInsertImage} title={t.toolbar.insertImage}>
              <ImageIcon size={15} />
            </button>
          </div>
        )}
      </div>

      <div className="toolbar-group toolbar-right">
        {onInstallApp && (
          <button
            type="button"
            className="tool-btn install-app-btn"
            onClick={onInstallApp}
            title={t.toolbar.installApp}
          >
            <MonitorDown size={15} />
            {!isSidePanel && <span className="install-label">{t.toolbar.installApp}</span>}
          </button>
        )}

        <button type="button" className="tool-btn" onClick={onOpenSearch} title={t.toolbar.search}>
          <Search size={15} />
        </button>

        <button type="button" className="tool-btn" onClick={onOpenPalette} title={t.toolbar.commandPalette}>
          <Command size={15} />
        </button>

        <div className="dropdown-wrap" ref={exportRef}>
          <button
            ref={exportBtnRef}
            type="button"
            className="tool-btn"
            aria-label={t.exportMenu.label}
            aria-haspopup="menu"
            aria-expanded={exportOpen}
            onClick={() => setExportOpen((v) => !v)}
            title={t.exportMenu.label}
            data-testid="export-menu-btn"
          >
            <Download size={15} />
          </button>
          {exportOpen && (
            <div className="dropdown-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="dropdown-item"
                onClick={() => {
                  setExportOpen(false);
                  onExportHtml();
                }}
              >
                <FileText size={14} />
                <span>{t.exportMenu.exportHtml}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="dropdown-item"
                onClick={() => {
                  setExportOpen(false);
                  onExportPdf();
                }}
              >
                <Printer size={14} />
                <span>{t.exportMenu.exportPdf}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="dropdown-item"
                onClick={() => {
                  setExportOpen(false);
                  onCopyRichText();
                }}
              >
                <Copy size={14} />
                <span>{t.exportMenu.copyRichText}</span>
              </button>
            </div>
          )}
        </div>

        <label className="select-pill" title={t.themes.label}>
          {theme === 'dark' ? <Moon size={13} /> : theme === 'sepia' ? <BookOpen size={13} /> : <Sun size={13} />}
          <select
            aria-label={t.themes.label}
            data-testid="theme-select"
            value={theme}
            onChange={(e) => onChangeTheme((e.currentTarget as HTMLSelectElement).value as ThemeMode)}
          >
            <option value="light">{t.themes.light}</option>
            <option value="dark">{t.themes.dark}</option>
            <option value="sepia">{t.themes.sepia}</option>
          </select>
        </label>

        <label className="select-pill" title={t.language.label}>
          <select
            aria-label={t.language.label}
            data-testid="lang-select"
            value={locale}
            onChange={(e) => setLocale((e.currentTarget as HTMLSelectElement).value)}
          >
            {availableLocales.map((loc) => (
              <option key={loc.code} value={loc.code}>
                {loc.code.toUpperCase()}
              </option>
            ))}
          </select>
        </label>

        {onOpenAbout && (
          <button
            type="button"
            className="tool-btn hide-mobile-xs"
            onClick={onOpenAbout}
            title={t.about.openAbout}
            aria-label={t.about.openAbout}
            data-testid="about-toolbar-btn"
          >
            <Info size={15} />
          </button>
        )}

        <button
          type="button"
          className={`tool-btn ${outlineOpen ? 'active' : ''}`}
          onClick={onToggleOutline}
          title={t.sidebars.toggleOutline}
        >
          <PanelRight size={16} />
        </button>

        {isSidePanel && onExpandSidePanel ? (
          <button
            type="button"
            className="tool-btn"
            onClick={onExpandSidePanel}
            title={t.sidebars.expandToTab}
            aria-label={t.sidebars.expandToTab}
          >
            <Maximize2 size={15} />
          </button>
        ) : (
          <button
            type="button"
            className="tool-btn hide-mobile-xs"
            onClick={onToggleZen}
            title={t.toolbar.zenMode}
            aria-label={t.toolbar.zenMode}
          >
            <Maximize2 size={15} />
          </button>
        )}
      </div>
    </header>
  );
}
