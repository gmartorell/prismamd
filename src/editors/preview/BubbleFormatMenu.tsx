import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import {
  AlertTriangle,
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  Quote,
  Sigma,
  Strikethrough,
} from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useI18n } from '../../i18n';

export function extractSelectionLatex(editor: Editor): string {
  const { from, to } = editor.state.selection;
  if (from === to) return '';
  return editor.state.doc
    .textBetween(from, to, ' ', (leaf) => {
      if (leaf.type.name === 'mathInline') return String(leaf.attrs.latex ?? '');
      if (leaf.type.name === 'rawHtmlInline') return String(leaf.attrs.value ?? '');
      if (leaf.type.name === 'image') return String(leaf.attrs.alt ?? '');
      return '';
    })
    .trim();
}

interface BubbleFormatMenuProps {
  editor: Editor | null;
  containerRef: { current: HTMLDivElement | null };
}

export function BubbleFormatMenu({ editor, containerRef }: BubbleFormatMenuProps) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  useEffect(() => {
    if (!linkMode || !editor) return;

    const handleOutsideMouseDown = (event: MouseEvent) => {
      const target = event.target as globalThis.Node | null;
      if (menuRef.current && target && menuRef.current.contains(target)) {
        return;
      }
      setLinkMode(false);
      setLinkUrl('');
      if (editor.isDestroyed || !editor.isFocused || editor.state.selection.empty) {
        setCoords(null);
      }
    };

    document.addEventListener('mousedown', handleOutsideMouseDown, true);
    return () => {
      document.removeEventListener('mousedown', handleOutsideMouseDown, true);
    };
  }, [linkMode, editor]);

  useEffect(() => {
    if (!editor) return;

    const container = containerRef.current;
    const scroller = container?.querySelector('.preview-editor-scroller') as HTMLElement | null;

    const update = () => {
      if (editor.isDestroyed) return;
      const { selection } = editor.state;
      if (
        selection.empty ||
        selection instanceof NodeSelection ||
        editor.isActive('codeBlock') ||
        (!editor.isFocused && !linkMode)
      ) {
        if (!linkMode || selection.empty) {
          setLinkMode(false);
          setCoords(null);
        }
        return;
      }

      const host = containerRef.current;
      if (!host) return;

      try {
        const start = editor.view.coordsAtPos(selection.from);
        const end = editor.view.coordsAtPos(selection.to);
        const containerRect = host.getBoundingClientRect();
        const scrollerRect = scroller?.getBoundingClientRect();

        if (
          scrollerRect &&
          scrollerRect.height > 0 &&
          (end.bottom < scrollerRect.top + 4 || start.top > scrollerRect.bottom - 4)
        ) {
          setLinkMode(false);
          setCoords(null);
          return;
        }

        const menuWidth = menuRef.current?.offsetWidth || 320;
        const menuHeight = menuRef.current?.offsetHeight || 36;
        const centerX = (start.left + end.right) / 2 - containerRect.left;

        const relStartTop = start.top - containerRect.top;
        const relEndBottom = end.bottom - containerRect.top;
        const aboveTop = relStartTop - menuHeight - 8;
        const top = relStartTop < 52 || aboveTop < 8 ? relEndBottom + 8 : aboveTop;

        const maxLeft =
          containerRect.width > 0 ? Math.max(8, containerRect.width - menuWidth - 8) : centerX;
        const left = Math.max(8, Math.min(maxLeft, centerX - menuWidth / 2));

        setCoords({ top, left });
      } catch {
        setCoords(null);
      }
    };

    const handleBlur = () => {
      window.setTimeout(() => {
        if (!editor.isDestroyed && !editor.isFocused && !linkMode) {
          setCoords(null);
        }
      }, 150);
    };

    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    editor.on('blur', handleBlur);
    scroller?.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);

    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
      editor.off('blur', handleBlur);
      scroller?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [editor, containerRef, linkMode]);

  if (!editor || !coords) return null;

  const applyLink = () => {
    const trimmed = linkUrl.trim();
    if (trimmed) {
      editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run();
    } else {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    }
    setLinkMode(false);
    setLinkUrl('');
  };

  const convertToInlineMath = () => {
    const { from, to } = editor.state.selection;
    const selectedText = extractSelectionLatex(editor);
    editor
      .chain()
      .focus()
      .deleteRange({ from, to })
      .insertContent({ type: 'mathInline', attrs: { latex: selectedText || 'x' } })
      .run();
  };

  return (
    <div
      ref={menuRef}
      className="bubble-menu"
      style={{ top: `${coords.top}px`, left: `${coords.left}px` }}
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest('input')) {
          e.preventDefault();
        }
      }}
    >
      {linkMode ? (
        <div className="bubble-link-form">
          <input
            type="url"
            className="bubble-link-input"
            value={linkUrl}
            placeholder={t.toolbar.linkInputPlaceholder}
            autoFocus
            onInput={(e) => setLinkUrl((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                applyLink();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setLinkMode(false);
                setLinkUrl('');
                editor.commands.focus();
              }
            }}
          />
          <button type="button" className="bubble-btn active" onClick={applyLink}>
            {t.toolbar.confirmOk}
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            className={`bubble-btn ${editor.isActive('bold') ? 'active' : ''}`}
            title={t.toolbar.bold}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold size={14} />
          </button>
          <button
            type="button"
            className={`bubble-btn ${editor.isActive('italic') ? 'active' : ''}`}
            title={t.toolbar.italic}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic size={14} />
          </button>
          <button
            type="button"
            className={`bubble-btn ${editor.isActive('strike') ? 'active' : ''}`}
            title={t.toolbar.strike}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <Strikethrough size={14} />
          </button>
          <button
            type="button"
            className={`bubble-btn ${editor.isActive('code') ? 'active' : ''}`}
            title={t.toolbar.inlineCode}
            onClick={() => editor.chain().focus().toggleCode().run()}
          >
            <Code size={14} />
          </button>
          <button
            type="button"
            className="bubble-btn"
            title={t.toolbar.mathInline}
            onClick={convertToInlineMath}
          >
            <Sigma size={14} />
          </button>
          <button
            type="button"
            className={`bubble-btn ${editor.isActive('link') ? 'active' : ''}`}
            title={t.toolbar.link}
            onClick={() => {
              const existing = editor.getAttributes('link').href as string | undefined;
              setLinkUrl(existing ?? '');
              setLinkMode(true);
            }}
          >
            <LinkIcon size={14} />
          </button>
          <span className="bubble-sep" />
          <button
            type="button"
            className={`bubble-btn ${editor.isActive('heading', { level: 1 }) ? 'active' : ''}`}
            title={t.toolbar.heading1}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          >
            <Heading1 size={14} />
          </button>
          <button
            type="button"
            className={`bubble-btn ${editor.isActive('heading', { level: 2 }) ? 'active' : ''}`}
            title={t.toolbar.heading2}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <Heading2 size={14} />
          </button>
          <button
            type="button"
            className={`bubble-btn ${editor.isActive('heading', { level: 3 }) ? 'active' : ''}`}
            title={t.toolbar.heading3}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          >
            <Heading3 size={14} />
          </button>
          <button
            type="button"
            className={`bubble-btn ${editor.isActive('blockquote') ? 'active' : ''}`}
            title={t.toolbar.quote}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            <Quote size={14} />
          </button>
          <button
            type="button"
            className={`bubble-btn ${editor.isActive('githubAlert') ? 'active' : ''}`}
            title={t.toolbar.alert}
            onClick={() => {
              if (editor.isActive('githubAlert')) {
                editor.chain().focus().lift('githubAlert').run();
              } else {
                editor.chain().focus().wrapIn('githubAlert', { alertType: 'NOTE' }).run();
              }
            }}
          >
            <AlertTriangle size={14} />
          </button>
        </>
      )}
    </div>
  );
}
