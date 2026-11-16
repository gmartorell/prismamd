import { Link2, Link2Off } from 'lucide-preact';
import { formatMessage, useI18n } from '../i18n';
import type { ViewMode } from '../workspace/fileSystem';

interface StatusBarProps {
  words: number;
  chars: number;
  readingMinutes: number;
  cursor: { line: number; col: number };
  viewMode: ViewMode;
  isDirty: boolean;
  hasDiskHandle: boolean;
  scrollSync: boolean;
  onToggleScrollSync: () => void;
  version: string;
  hasUpdate: boolean;
  onOpenVersionModal: () => void;
}

export function StatusBar({
  words,
  chars,
  readingMinutes,
  cursor,
  viewMode,
  isDirty,
  hasDiskHandle,
  scrollSync,
  onToggleScrollSync,
  version,
  hasUpdate,
  onOpenVersionModal,
}: StatusBarProps) {
  const { t } = useI18n();

  const statusText = isDirty
    ? t.status.modified
    : hasDiskHandle
      ? t.status.saved
      : t.status.draft;

  return (
    <footer className="status-bar">
      <div className="status-group">
        <span className={`status-pill ${isDirty ? 'dirty' : ''}`}>{statusText}</span>
        {viewMode !== 'preview' && (
          <span className="status-item">
            {formatMessage(t.status.lineCol, { line: cursor.line, col: cursor.col })}
          </span>
        )}
        <span className="status-item status-hint">{t.toolbar.formatHint}</span>
      </div>

      <div className="status-group">
        {viewMode === 'split' && (
          <button
            type="button"
            className={`status-sync-btn ${scrollSync ? 'active' : ''}`}
            onClick={onToggleScrollSync}
            title={scrollSync ? t.status.scrollSyncOn : t.status.scrollSyncOff}
          >
            {scrollSync ? <Link2 size={12} /> : <Link2Off size={12} />}
            <span>{scrollSync ? t.status.scrollSyncOn : t.status.scrollSyncOff}</span>
          </button>
        )}
        <span className="status-item">
          {words} {t.status.words}
        </span>
        <span className="status-item status-chars">
          {chars} {t.status.chars}
        </span>
        <span className="status-item status-reading">
          {readingMinutes} {t.status.minRead}
        </span>
        <button
          type="button"
          className={`status-version-btn ${hasUpdate ? 'has-update' : ''}`}
          onClick={onOpenVersionModal}
          data-testid="status-version-btn"
          title={`${t.about.versionLabel}: v${version} — ${t.about.menuCommand}`}
        >
          <span>v{version}</span>
          {hasUpdate && <span className="status-update-tag">{t.about.updateAvailableShort}</span>}
        </button>
      </div>
    </footer>
  );
}
