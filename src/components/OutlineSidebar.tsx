import { useI18n } from '../i18n';
import type { OutlineHeading } from '../markdown/bridge';

interface OutlineSidebarProps {
  headings: OutlineHeading[];
  onSelectHeading: (heading: OutlineHeading, index: number) => void;
}

export function OutlineSidebar({ headings, onSelectHeading }: OutlineSidebarProps) {
  const { t } = useI18n();

  return (
    <aside className="sidebar sidebar-right" aria-label={t.sidebars.outline}>
      <div className="sidebar-header">
        <span className="sidebar-title">{t.sidebars.outline}</span>
      </div>
      <div className="outline-list">
        {headings.length === 0 ? (
          <div className="sidebar-empty-muted">{t.sidebars.noHeadings}</div>
        ) : (
          headings.map((h, idx) => (
            <button
              key={h.id}
              type="button"
              className={`outline-item level-${h.level}`}
              style={{ paddingLeft: `${10 + (h.level - 1) * 12}px` }}
              onClick={() => onSelectHeading(h, idx)}
              title={h.text}
            >
              <span className="outline-level">H{h.level}</span>
              <span className="outline-text">{h.text}</span>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
