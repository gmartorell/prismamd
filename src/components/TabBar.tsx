import { Plus, Sparkles, X } from 'lucide-preact';
import { useRef } from 'preact/hooks';
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
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const moveFocusToTab = (nextIndex: number) => {
    if (tabs.length === 0) return;
    const wrapped = (nextIndex + tabs.length) % tabs.length;
    const target = tabs[wrapped];
    if (!target) return;
    onSelectTab(target.id);
    tabRefs.current[wrapped]?.focus();
  };

  return (
    <div className="tab-bar">
      <div className="tab-list" role="tablist">
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          const isDirty = tab.content !== tab.savedContent;
          const label = tab.isScratchpad ? t.files.scratchpad : tab.title;
          const closeLabel = t.files.closeTab.includes('{name}')
            ? formatMessage(t.files.closeTab, { name: label })
            : `${t.files.closeTab}: ${label}`;

          return (
            <div
              key={tab.id}
              role="presentation"
              className={`tab-item ${isActive ? 'active' : ''} ${tab.isScratchpad ? 'scratchpad' : ''}`}
              onClick={() => onSelectTab(tab.id)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onCloseTab(tab.id);
                }
              }}
              title={tab.relativePath ?? label}
            >
              <button
                ref={(el) => {
                  tabRefs.current[index] = el;
                }}
                type="button"
                role="tab"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                className="tab-trigger"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectTab(tab.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    moveFocusToTab(index + 1);
                  } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    moveFocusToTab(index - 1);
                  } else if (e.key === 'Home') {
                    e.preventDefault();
                    moveFocusToTab(0);
                  } else if (e.key === 'End') {
                    e.preventDefault();
                    moveFocusToTab(tabs.length - 1);
                  } else if (e.key === 'Delete') {
                    e.preventDefault();
                    onCloseTab(tab.id);
                  }
                }}
              >
                {tab.isScratchpad && <Sparkles size={12} className="tab-scratch-icon" />}
                <span className="tab-title">{label}</span>
                {isDirty && <span className="tab-dirty-dot" title={t.files.unsavedDot} />}
              </button>
              <button
                type="button"
                className="tab-close-btn"
                aria-label={closeLabel}
                title={closeLabel}
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="tab-new-btn"
        onClick={onNewTab}
        title={t.files.newNote}
        aria-label={t.files.newNote}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
