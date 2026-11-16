import { Plus, Sparkles, X } from 'lucide-preact';
import { formatMessage, useI18n } from '../i18n';
import type { EditorTab } from '../workspace/fileSystem';

interface TabBarProps {
  tabs: EditorTab[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onNewTab }: TabBarProps) {
  const { t } = useI18n();

  return (
    <div className="tab-bar" role="tablist">
      <div className="tab-list">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isDirty = tab.content !== tab.savedContent && !tab.isScratchpad;
          const label = tab.isScratchpad ? t.files.scratchpad : tab.title;

          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              className={`tab-item ${isActive ? 'active' : ''} ${tab.isScratchpad ? 'scratchpad' : ''}`}
              onClick={() => onSelectTab(tab.id)}
              onMouseDown={(e) => {
                if (e.button === 1 && !tab.isScratchpad) {
                  e.preventDefault();
                  onCloseTab(tab.id);
                }
              }}
              title={tab.relativePath ?? label}
            >
              {tab.isScratchpad && <Sparkles size={12} className="tab-scratch-icon" />}
              <span className="tab-title">{label}</span>
              {isDirty && <span className="tab-dirty-dot" title={t.files.unsavedDot} />}
              {!tab.isScratchpad && (
                <button
                  type="button"
                  className="tab-close-btn"
                  aria-label={formatMessage(t.files.closeTab, { name: label })}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button type="button" className="tab-new-btn" onClick={onNewTab} title={t.files.newNote}>
        <Plus size={14} />
      </button>
    </div>
  );
}
