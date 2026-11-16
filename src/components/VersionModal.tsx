import { CheckCircle2, RefreshCw, Sparkles, WifiOff, X } from 'lucide-preact';
import { useEffect, useRef } from 'preact/hooks';
import { formatMessage, useI18n } from '../i18n';
import type { RuntimeChannel, UpdateCheckResult } from '../utils/version';

interface VersionModalProps {
  open: boolean;
  channel: RuntimeChannel;
  updateState: UpdateCheckResult;
  onCheckUpdates: () => void;
  onApplyUpdate: () => void;
  onClose: () => void;
}

export function VersionModal({
  open,
  channel,
  updateState,
  onCheckUpdates,
  onApplyUpdate,
  onClose,
}: VersionModalProps) {
  const { t } = useI18n();
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const focusTimer = window.setTimeout(() => closeBtnRef.current?.focus(), 10);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  const isChecking = updateState.status === 'checking';
  const hasUpdate = updateState.status === 'update-available';

  return (
    <div
      className="version-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="version-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prismamd-version-title"
      >
        <div className="version-modal-header">
          <div className="version-modal-title-wrap">
            <span className="brand-mark">◆</span>
            <h2 id="prismamd-version-title" className="version-modal-title">
              {t.about.title}
            </h2>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className="tab-close-btn"
            onClick={onClose}
            aria-label={t.about.close}
            title={t.about.close}
          >
            <X size={15} />
          </button>
        </div>

        <div className="version-modal-body">
          <div className="version-meta-row">
            <span className="version-meta-label">{t.about.currentVersion}</span>
            <code className="version-meta-value" data-testid="about-current-version">
              v{updateState.currentVersion}
            </code>
          </div>

          <div className="version-meta-row">
            <span className="version-meta-label">{t.about.channelLabel}</span>
            <span className="version-meta-value">
              {channel === 'extension' ? t.about.channelExtension : t.about.channelPwa}
            </span>
          </div>

          {hasUpdate && updateState.latestVersion && (
            <div className="version-meta-row">
              <span className="version-meta-label">{t.about.latestVersion}</span>
              <code className="version-meta-value accent">v{updateState.latestVersion}</code>
            </div>
          )}

          <div className={`version-status-card status-${updateState.status}`}>
            {isChecking && (
              <>
                <RefreshCw size={15} className="spin" />
                <span>{t.about.checkingUpdates}</span>
              </>
            )}
            {updateState.status === 'up-to-date' && (
              <>
                <CheckCircle2 size={15} />
                <span>{t.about.upToDate}</span>
              </>
            )}
            {hasUpdate && (
              <>
                <Sparkles size={15} />
                <span>
                  {formatMessage(t.about.updateAvailable, {
                    version: updateState.latestVersion ?? updateState.currentVersion,
                  })}
                </span>
              </>
            )}
            {updateState.status === 'offline' && (
              <>
                <WifiOff size={15} />
                <span>{t.about.offlineStatus}</span>
              </>
            )}
            {updateState.status === 'managed-by-store' && (
              <>
                <CheckCircle2 size={15} />
                <span>{t.about.managedByStore}</span>
              </>
            )}
            {updateState.status === 'idle' && (
              <>
                <CheckCircle2 size={15} />
                <span>{t.appName} v{updateState.currentVersion}</span>
              </>
            )}
          </div>
        </div>

        <div className="version-modal-footer">
          <button
            type="button"
            className="version-btn secondary"
            onClick={onCheckUpdates}
            disabled={isChecking}
            data-testid="check-updates-btn"
          >
            <RefreshCw size={13} className={isChecking ? 'spin' : ''} />
            <span>{t.about.checkUpdates}</span>
          </button>

          {hasUpdate && (
            <button
              type="button"
              className="version-btn primary"
              onClick={onApplyUpdate}
              data-testid="apply-update-btn"
            >
              <Sparkles size={13} />
              <span>{t.about.applyUpdate}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
