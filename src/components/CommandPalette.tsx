import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useI18n } from '../i18n';

export interface PaletteCommand {
  id: string;
  category: string;
  title: string;
  shortcut?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  commands: PaletteCommand[];
  onClose: () => void;
}

export function CommandPalette({ open, commands, onClose }: CommandPaletteProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (cmd) =>
        cmd.title.toLowerCase().includes(q) ||
        cmd.category.toLowerCase().includes(q),
    );
  }, [commands, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!open) return null;

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette-modal" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          className="palette-input"
          value={query}
          placeholder={t.palette.placeholder}
          onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              if (filtered.length > 0) setSelectedIndex((i) => (i + 1) % filtered.length);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              if (filtered.length > 0) setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length);
            } else if (e.key === 'Enter' && filtered.length > 0) {
              e.preventDefault();
              const chosen = filtered[selectedIndex] ?? filtered[0];
              onClose();
              chosen.run();
            }
          }}
        />
        <div className="palette-list">
          {filtered.length === 0 ? (
            <div className="palette-empty">{t.palette.noResults}</div>
          ) : (
            filtered.map((cmd, idx) => (
              <button
                key={cmd.id}
                type="button"
                className={`palette-item ${idx === selectedIndex ? 'selected' : ''}`}
                onMouseEnter={() => setSelectedIndex(idx)}
                onClick={() => {
                  onClose();
                  cmd.run();
                }}
              >
                <span className="palette-cat">{cmd.category}</span>
                <span className="palette-title">{cmd.title}</span>
                {cmd.shortcut && <kbd className="palette-kbd">{cmd.shortcut}</kbd>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
