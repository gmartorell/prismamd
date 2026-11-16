import type { Editor } from '@tiptap/core';
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

interface TableFloatingBarProps {
  editor: Editor | null;
}

export function TableFloatingBar({ editor }: TableFloatingBarProps) {
  const { t } = useI18n();
  const [inTable, setInTable] = useState(false);

  useEffect(() => {
    if (!editor) return;
    const sync = () => {
      if (!editor.isDestroyed) {
        setInTable(editor.isActive('table'));
      }
    };
    editor.on('selectionUpdate', sync);
    editor.on('transaction', sync);
    sync();
    return () => {
      editor.off('selectionUpdate', sync);
      editor.off('transaction', sync);
    };
  }, [editor]);

  if (!editor || !inTable) return null;

  return (
    <div className="table-floating-bar" onMouseDown={(e) => e.preventDefault()}>
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
        className="table-bar-btn icon-only"
        onClick={() => editor.chain().focus().setCellAttribute('textAlign', 'left').run()}
        title={t.table.alignLeft}
      >
        <AlignLeft size={13} />
      </button>
      <button
        type="button"
        className="table-bar-btn icon-only"
        onClick={() => editor.chain().focus().setCellAttribute('textAlign', 'center').run()}
        title={t.table.alignCenter}
      >
        <AlignCenter size={13} />
      </button>
      <button
        type="button"
        className="table-bar-btn icon-only"
        onClick={() => editor.chain().focus().setCellAttribute('textAlign', 'right').run()}
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
