import type { Editor } from '@tiptap/core';
import {
  AlertTriangle,
  FileCode,
  GitBranch,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  Sigma,
  Table as TableIcon,
} from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useI18n } from '../../i18n';

export interface SlashItem {
  id: string;
  title: string;
  desc: string;
  keywords: string[];
  icon: ComponentChildren;
  run: (editor: Editor, requestImage: () => void) => void;
}

interface SlashState {
  query: string;
  rangeFrom: number;
  rangeTo: number;
  top: number;
  left: number;
}

interface SlashCommandMenuProps {
  editor: Editor | null;
  containerRef: { current: HTMLDivElement | null };
  onRequestImage: () => void;
  keyHandlerRef: { current: ((event: KeyboardEvent) => boolean) | null };
}

export function SlashCommandMenu({
  editor,
  containerRef,
  onRequestImage,
  keyHandlerRef,
}: SlashCommandMenuProps) {
  const { t } = useI18n();
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const items = useMemo<SlashItem[]>(
    () => [
      {
        id: 'h1',
        title: t.slash.items.h1.title,
        desc: t.slash.items.h1.desc,
        keywords: ['h1', 'heading', 'titulo', 'encabezado'],
        icon: <Heading1 size={15} />,
        run: (ed) => ed.chain().focus().setHeading({ level: 1 }).run(),
      },
      {
        id: 'h2',
        title: t.slash.items.h2.title,
        desc: t.slash.items.h2.desc,
        keywords: ['h2', 'heading', 'subtitulo', 'encabezado'],
        icon: <Heading2 size={15} />,
        run: (ed) => ed.chain().focus().setHeading({ level: 2 }).run(),
      },
      {
        id: 'h3',
        title: t.slash.items.h3.title,
        desc: t.slash.items.h3.desc,
        keywords: ['h3', 'heading', 'apartado'],
        icon: <Heading3 size={15} />,
        run: (ed) => ed.chain().focus().setHeading({ level: 3 }).run(),
      },
      {
        id: 'bullet',
        title: t.slash.items.bulletList.title,
        desc: t.slash.items.bulletList.desc,
        keywords: ['list', 'bullet', 'lista', 'vinetas', 'ul'],
        icon: <List size={15} />,
        run: (ed) => ed.chain().focus().toggleBulletList().run(),
      },
      {
        id: 'ordered',
        title: t.slash.items.orderedList.title,
        desc: t.slash.items.orderedList.desc,
        keywords: ['ordered', 'numbered', 'numerada', 'ol', 'lista'],
        icon: <ListOrdered size={15} />,
        run: (ed) => ed.chain().focus().toggleOrderedList().run(),
      },
      {
        id: 'task',
        title: t.slash.items.taskList.title,
        desc: t.slash.items.taskList.desc,
        keywords: ['task', 'todo', 'checklist', 'tareas', 'casillas'],
        icon: <ListTodo size={15} />,
        run: (ed) => ed.chain().focus().toggleTaskList().run(),
      },
      {
        id: 'table',
        title: t.slash.items.table.title,
        desc: t.slash.items.table.desc,
        keywords: ['table', 'tabla', 'gfm', 'grid'],
        icon: <TableIcon size={15} />,
        run: (ed) => ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      },
      {
        id: 'code',
        title: t.slash.items.codeBlock.title,
        desc: t.slash.items.codeBlock.desc,
        keywords: ['code', 'codigo', 'pre', 'snippet'],
        icon: <FileCode size={15} />,
        run: (ed) => ed.chain().focus().toggleCodeBlock().run(),
      },
      {
        id: 'mermaid',
        title: t.slash.items.mermaid.title,
        desc: t.slash.items.mermaid.desc,
        keywords: ['mermaid', 'diagram', 'diagrama', 'flowchart', 'grafo'],
        icon: <GitBranch size={15} />,
        run: (ed) =>
          ed
            .chain()
            .focus()
            .insertContent({
              type: 'mermaidBlock',
              attrs: { code: 'flowchart LR\n  A[Inicio] --> B[Proceso]\n  B --> C[Fin]' },
            })
            .run(),
      },
      {
        id: 'mathBlock',
        title: t.slash.items.mathBlock.title,
        desc: t.slash.items.mathBlock.desc,
        keywords: ['math', 'latex', 'katex', 'formula', 'ecuacion', 'bloque'],
        icon: <Sigma size={15} />,
        run: (ed) =>
          ed
            .chain()
            .focus()
            .insertContent({
              type: 'mathBlock',
              attrs: { latex: '\\sum_{i=1}^{n} x_i = \\frac{n(n+1)}{2}' },
            })
            .run(),
      },
      {
        id: 'mathInline',
        title: t.slash.items.mathInline.title,
        desc: t.slash.items.mathInline.desc,
        keywords: ['inline', 'math', 'formula', 'latex', '$'],
        icon: <Sigma size={15} />,
        run: (ed) =>
          ed
            .chain()
            .focus()
            .insertContent({ type: 'mathInline', attrs: { latex: 'E = mc^2' } })
            .run(),
      },
      {
        id: 'alertNote',
        title: t.slash.items.alertNote.title,
        desc: t.slash.items.alertNote.desc,
        keywords: ['note', 'nota', 'alert', 'alerta', 'callout'],
        icon: <AlertTriangle size={15} />,
        run: (ed) =>
          ed
            .chain()
            .focus()
            .insertContent({
              type: 'githubAlert',
              attrs: { alertType: 'NOTE' },
              content: [{ type: 'paragraph' }],
            })
            .run(),
      },
      {
        id: 'alertWarning',
        title: t.slash.items.alertWarning.title,
        desc: t.slash.items.alertWarning.desc,
        keywords: ['warning', 'aviso', 'advertencia', 'alert', 'alerta'],
        icon: <AlertTriangle size={15} />,
        run: (ed) =>
          ed
            .chain()
            .focus()
            .insertContent({
              type: 'githubAlert',
              attrs: { alertType: 'WARNING' },
              content: [{ type: 'paragraph' }],
            })
            .run(),
      },
      {
        id: 'quote',
        title: t.slash.items.quote.title,
        desc: t.slash.items.quote.desc,
        keywords: ['quote', 'cita', 'blockquote'],
        icon: <Quote size={15} />,
        run: (ed) => ed.chain().focus().toggleBlockquote().run(),
      },
      {
        id: 'divider',
        title: t.slash.items.divider.title,
        desc: t.slash.items.divider.desc,
        keywords: ['divider', 'hr', 'linea', 'separador', 'divisor'],
        icon: <Minus size={15} />,
        run: (ed) => ed.chain().focus().setHorizontalRule().run(),
      },
      {
        id: 'image',
        title: t.slash.items.image.title,
        desc: t.slash.items.image.desc,
        keywords: ['image', 'imagen', 'base64', 'foto', 'png'],
        icon: <ImageIcon size={15} />,
        run: (_ed, requestImage) => requestImage(),
      },
    ],
    [t],
  );

  const filtered = useMemo(() => {
    if (!slash) return [];
    const q = slash.query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.desc.toLowerCase().includes(q) ||
        item.keywords.some((kw) => kw.includes(q)),
    );
  }, [items, slash]);

  const executeItem = (item: SlashItem) => {
    if (!editor || !slash) return;
    editor.chain().focus().deleteRange({ from: slash.rangeFrom, to: slash.rangeTo }).run();
    item.run(editor, onRequestImage);
    setSlash(null);
  };

  useEffect(() => {
    setSelectedIndex(0);
  }, [slash?.query]);

  useEffect(() => {
    if (!editor) return;

    const evaluateSlash = () => {
      if (editor.isDestroyed) return;
      const { selection } = editor.state;
      if (!selection.empty || editor.isActive('codeBlock')) {
        setSlash(null);
        return;
      }

      const { $from } = selection;
      if ($from.parent.type.name !== 'paragraph') {
        setSlash(null);
        return;
      }

      const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\0', '\0');
      const match = textBefore.match(/(?:^|\s)\/([^\s/]*)$/);
      if (!match) {
        setSlash(null);
        return;
      }

      const fullMatch = match[0];
      const leadingSpace = fullMatch.startsWith('/') ? 0 : 1;
      const slashStartOffset = $from.parentOffset - fullMatch.length + leadingSpace;
      const blockStartPos = $from.start();
      const rangeFrom = blockStartPos + slashStartOffset;
      const rangeTo = selection.from;

      const container = containerRef.current;
      if (!container) return;

      try {
        const coords = editor.view.coordsAtPos(rangeTo);
        const containerRect = container.getBoundingClientRect();
        const top = Math.min(containerRect.height - 220, Math.max(12, coords.bottom - containerRect.top + 6));
        const left = Math.max(12, Math.min(containerRect.width - 280, coords.left - containerRect.left));
        setSlash({
          query: match[1] ?? '',
          rangeFrom,
          rangeTo,
          top,
          left,
        });
      } catch {
        setSlash(null);
      }
    };

    editor.on('selectionUpdate', evaluateSlash);
    editor.on('update', evaluateSlash);
    return () => {
      editor.off('selectionUpdate', evaluateSlash);
      editor.off('update', evaluateSlash);
    };
  }, [editor, containerRef]);

  useEffect(() => {
    if (!slash) {
      keyHandlerRef.current = null;
      return;
    }

    keyHandlerRef.current = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSlash(null);
        return true;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (filtered.length > 0) {
          setSelectedIndex((idx) => (idx + 1) % filtered.length);
        }
        return true;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (filtered.length > 0) {
          setSelectedIndex((idx) => (idx - 1 + filtered.length) % filtered.length);
        }
        return true;
      }
      if (event.key === 'Enter' && filtered.length > 0) {
        event.preventDefault();
        executeItem(filtered[selectedIndex] ?? filtered[0]);
        return true;
      }
      return false;
    };

    return () => {
      keyHandlerRef.current = null;
    };
  }, [slash, filtered, selectedIndex, keyHandlerRef]);

  if (!slash) return null;

  return (
    <div
      ref={listRef}
      className="slash-menu"
      style={{ top: `${slash.top}px`, left: `${slash.left}px` }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="slash-menu-header">{t.slash.title}</div>
      {filtered.length === 0 ? (
        <div className="slash-menu-empty">{t.slash.empty}</div>
      ) : (
        <div className="slash-menu-list">
          {filtered.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              className={`slash-menu-item ${idx === selectedIndex ? 'selected' : ''}`}
              onMouseEnter={() => setSelectedIndex(idx)}
              onClick={() => executeItem(item)}
            >
              <span className="slash-item-icon">{item.icon}</span>
              <span className="slash-item-body">
                <span className="slash-item-title">{item.title}</span>
                <span className="slash-item-desc">{item.desc}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
