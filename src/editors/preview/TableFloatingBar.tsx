import type { Editor } from '@tiptap/core';
import { isInTable, selectedRect } from '@tiptap/pm/tables';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Columns,
  Rows,
  Trash2,
} from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { useI18n } from '../../i18n';

export type TableColumnAlign = 'left' | 'center' | 'right' | null;

export function getActiveTableColumnAlignment(editor: Editor): TableColumnAlign {
  const { state } = editor;
  if (!isInTable(state)) return null;

  try {
    const rect = selectedRect(state);
    const cellOffsets = rect.map.cellsInRect({
      left: rect.left,
      right: rect.right,
      top: 0,
      bottom: rect.map.height,
    });
    if (cellOffsets.length === 0) return null;

    let detected: TableColumnAlign | undefined;
    for (const relPos of cellOffsets) {
      const cell = rect.table.nodeAt(relPos);
      const raw = cell?.attrs?.textAlign;
      const align: TableColumnAlign =
        raw === 'left' || raw === 'center' || raw === 'right' ? raw : null;
      if (detected === undefined) {
        detected = align;
      } else if (detected !== align) {
        return null;
      }
    }
    return detected ?? null;
  } catch {
    return null;
  }
}

export function setTableColumnAlignment(editor: Editor, align: TableColumnAlign): boolean {
  const { state } = editor;
  if (!isInTable(state)) return false;

  let rect;
  try {
    rect = selectedRect(state);
  } catch {
    return false;
  }

  const { map, table, tableStart } = rect;
  const cellOffsets = map.cellsInRect({
    left: rect.left,
    right: rect.right,
    top: 0,
    bottom: map.height,
  });
  if (cellOffsets.length === 0) return false;

  const allAlreadyAligned =
    align !== null &&
    cellOffsets.every((relPos) => {
      const cell = table.nodeAt(relPos);
      return cell?.attrs?.textAlign === align;
    });
  const nextAlign: TableColumnAlign = allAlreadyAligned ? null : align;

  const tr = state.tr;
  for (const relPos of cellOffsets) {
    const cell = table.nodeAt(relPos);
    if (!cell) continue;
    tr.setNodeMarkup(tableStart + relPos, undefined, {
      ...cell.attrs,
      textAlign: nextAlign,
    });
  }

  if (tr.docChanged) {
    editor.view.dispatch(tr);
  }
  editor.commands.focus();
  return true;
}

interface TableFloatingBarProps {
  editor: Editor | null;
}

export function TableFloatingBar({ editor }: TableFloatingBarProps) {
  const { t } = useI18n();
  const [inTable, setInTable] = useState(false);
  const [barTop, setBarTop] = useState(6);
  const [activeAlign, setActiveAlign] = useState<TableColumnAlign>(null);

  useEffect(() => {
    if (!editor) return;

    const shell = editor.view.dom.closest('.preview-editor-shell') as HTMLElement | null;
    const scroller = shell?.querySelector('.preview-editor-scroller') as HTMLElement | null;

    const sync = () => {
      if (editor.isDestroyed) return;
      if (!editor.isActive('table')) {
        setInTable(false);
        return;
      }

      setActiveAlign(getActiveTableColumnAlignment(editor));

      if (!shell) {
        setInTable(true);
        setBarTop(6);
        return;
      }

      const shellRect = shell.getBoundingClientRect();
      if (shellRect.height <= 0) {
        setInTable(true);
        setBarTop(6);
        return;
      }

      try {
        const domInfo = editor.view.domAtPos(editor.state.selection.from);
        const startEl =
          domInfo.node instanceof HTMLElement ? domInfo.node : domInfo.node.parentElement;
        const tableEl = startEl?.closest('table');
        if (!tableEl) {
          setInTable(true);
          setBarTop(6);
          return;
        }

        const tableRect = tableEl.getBoundingClientRect();
        if (tableRect.bottom < shellRect.top + 16 || tableRect.top > shellRect.bottom - 16) {
          setInTable(false);
          return;
        }

        const aboveTable = tableRect.top - shellRect.top - 38;
        let nextTop = 6;
        if (aboveTable >= 6) {
          nextTop = Math.round(aboveTable);
        } else {
          const cellEl = startEl?.closest('th, td');
          const cellRect = cellEl?.getBoundingClientRect();
          if (cellRect && cellRect.top - shellRect.top < 46) {
            nextTop = Math.min(
              Math.max(6, Math.round(shellRect.height - 42)),
              Math.round(cellRect.bottom - shellRect.top + 6),
            );
          } else {
            nextTop = 6;
          }
        }

        setBarTop(nextTop);
        setInTable(true);
      } catch {
        setBarTop(6);
        setInTable(true);
      }
    };

    const handleBlur = () => {
      window.setTimeout(() => {
        if (!editor.isDestroyed && !editor.isFocused) {
          setInTable(false);
        }
      }, 120);
    };

    editor.on('selectionUpdate', sync);
    editor.on('transaction', sync);
    editor.on('focus', sync);
    editor.on('blur', handleBlur);
    scroller?.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    sync();

    return () => {
      editor.off('selectionUpdate', sync);
      editor.off('transaction', sync);
      editor.off('focus', sync);
      editor.off('blur', handleBlur);
      scroller?.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [editor]);

  if (!editor || !inTable) return null;

  return (
    <div
      className="table-floating-bar"
      style={{
        position: 'absolute',
        top: `${barTop}px`,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 38,
        border: '1px solid var(--border-strong)',
        borderRadius: '8px',
        boxShadow: 'var(--shadow-pop)',
        maxWidth: 'calc(100% - 16px)',
        width: 'max-content',
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className="table-bar-btn"
        onClick={() => editor.chain().focus().addRowBefore().run()}
        title={t.table.addRowAbove}
      >
        <Rows size={13} /> +{t.table.addRowAbove}
      </button>
      <button
        type="button"
        className="table-bar-btn"
        onClick={() => editor.chain().focus().addRowAfter().run()}
        title={t.table.addRowBelow}
      >
        +{t.table.addRowBelow}
      </button>
      <button
        type="button"
        className="table-bar-btn"
        onClick={() => editor.chain().focus().deleteRow().run()}
        title={t.table.deleteRow}
      >
        −{t.table.deleteRow}
      </button>
      <span className="bubble-sep" />
      <button
        type="button"
        className="table-bar-btn"
        onClick={() => editor.chain().focus().addColumnBefore().run()}
        title={t.table.addColLeft}
      >
        <Columns size={13} /> +{t.table.addColLeft}
      </button>
      <button
        type="button"
        className="table-bar-btn"
        onClick={() => editor.chain().focus().addColumnAfter().run()}
        title={t.table.addColRight}
      >
        +{t.table.addColRight}
      </button>
      <button
        type="button"
        className="table-bar-btn"
        onClick={() => editor.chain().focus().deleteColumn().run()}
        title={t.table.deleteCol}
      >
        −{t.table.deleteCol}
      </button>
      <span className="bubble-sep" />
      <button
        type="button"
        className={`table-bar-btn icon-only ${activeAlign === 'left' ? 'active' : ''}`}
        onClick={() => setTableColumnAlignment(editor, 'left')}
        title={t.table.alignLeft}
      >
        <AlignLeft size={13} />
      </button>
      <button
        type="button"
        className={`table-bar-btn icon-only ${activeAlign === 'center' ? 'active' : ''}`}
        onClick={() => setTableColumnAlignment(editor, 'center')}
        title={t.table.alignCenter}
      >
        <AlignCenter size={13} />
      </button>
      <button
        type="button"
        className={`table-bar-btn icon-only ${activeAlign === 'right' ? 'active' : ''}`}
        onClick={() => setTableColumnAlignment(editor, 'right')}
        title={t.table.alignRight}
      >
        <AlignRight size={13} />
      </button>
      <span className="bubble-sep" />
      <button
        type="button"
        className="table-bar-btn danger"
        onClick={() => editor.chain().focus().deleteTable().run()}
        title={t.table.deleteTable}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}
