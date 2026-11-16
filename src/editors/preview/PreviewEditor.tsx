import { Editor } from '@tiptap/core';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import Placeholder from '@tiptap/extension-placeholder';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import { forwardRef } from 'preact/compat';
import { useEffect, useImperativeHandle, useRef, useState } from 'preact/hooks';
import { useI18n } from '../../i18n';
import { markdownToProseMirrorDoc, proseMirrorDocToMarkdown } from '../../markdown/bridge';
import { fileToDataUri, sanitizeImageAlt } from '../../markdown/imageDataUri';
import type { ThemeMode } from '../../renderers/mermaidRenderer';
import { BubbleFormatMenu } from './BubbleFormatMenu';
import { updateNodeUiContext } from './nodeUiContext';
import { FrontmatterExtension } from './nodes/FrontmatterExtension';
import { GithubAlertExtension } from './nodes/GithubAlertExtension';
import { MathBlockExtension, MathInlineExtension } from './nodes/MathExtensions';
import { MermaidExtension } from './nodes/MermaidExtension';
import { RawHtmlBlockExtension, RawHtmlInlineExtension } from './nodes/RawHtmlExtensions';
import { SlashCommandMenu } from './SlashCommandMenu';
import { TableFloatingBar } from './TableFloatingBar';

export interface PreviewEditorHandle {
  focus: () => void;
  setScrollRatio: (ratio: number) => void;
  scrollToHeading: (index: number, text: string) => void;
  runAction: (action: PreviewFormatAction) => void;
  insertImageFromFile: (file: File) => Promise<void>;
}

export type PreviewFormatAction =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'quote'
  | 'codeBlock'
  | 'table'
  | 'mermaid'
  | 'mathInline'
  | 'mathBlock'
  | 'alert'
  | 'divider';

interface PreviewEditorProps {
  docKey: string;
  markdown: string;
  theme: ThemeMode;
  onChange: (nextMarkdown: string) => void;
  onScrollRatio?: (ratio: number) => void;
  onSaveShortcut?: () => void;
  onRequestImageFile: () => void;
}

const lowlight = createLowlight(common);

const AlignedTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      textAlign: {
        default: null,
        parseHTML: (element: HTMLElement) => element.style.textAlign || null,
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.textAlign ? { style: `text-align: ${String(attributes.textAlign)}` } : {},
      },
    };
  },
});

const AlignedTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      textAlign: {
        default: null,
        parseHTML: (element: HTMLElement) => element.style.textAlign || null,
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.textAlign ? { style: `text-align: ${String(attributes.textAlign)}` } : {},
      },
    };
  },
});

export const PreviewEditor = forwardRef<PreviewEditorHandle, PreviewEditorProps>(function PreviewEditor(
  {
    docKey,
    markdown: markdownText,
    theme,
    onChange,
    onScrollRatio,
    onSaveShortcut,
    onRequestImageFile,
  },
  ref,
) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const [editorStateTick, setEditorStateTick] = useState(0);

  const lastSyncedMdRef = useRef(markdownText);
  const suppressScrollRef = useRef(false);
  const slashKeyHandlerRef = useRef<((event: KeyboardEvent) => boolean) | null>(null);

  const callbacksRef = useRef({ onChange, onScrollRatio, onSaveShortcut });
  callbacksRef.current = { onChange, onScrollRatio, onSaveShortcut };

  useEffect(() => {
    updateNodeUiContext(theme, t);
  }, [theme, t]);

  useEffect(() => {
    const mountEl = mountRef.current;
    if (!mountEl) return;

    updateNodeUiContext(theme, t);
    let initialDoc;
    try {
      initialDoc = markdownToProseMirrorDoc(markdownText);
    } catch {
      initialDoc = { type: 'doc', content: [{ type: 'paragraph' }] };
    }
    lastSyncedMdRef.current = markdownText;

    const handleImages = async (files: FileList | File[], insertPos?: number) => {
      const editor = editorRef.current;
      if (!editor) return;
      const images = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (images.length === 0) return;

      for (const imgFile of images) {
        const dataUri = await fileToDataUri(imgFile);
        const alt = sanitizeImageAlt(imgFile.name);
        if (typeof insertPos === 'number') {
          editor.chain().focus().insertContentAt(insertPos, { type: 'image', attrs: { src: dataUri, alt } }).run();
        } else {
          editor.chain().focus().setImage({ src: dataUri, alt }).run();
        }
      }
    };

    const editor = new Editor({
      element: mountEl,
      content: initialDoc,
      extensions: [
        StarterKit.configure({
          codeBlock: false,
          link: {
            openOnClick: false,
            autolink: true,
          },
        }),
        CodeBlockLowlight.configure({
          lowlight,
          defaultLanguage: 'plaintext',
        }),
        Table.configure({
          resizable: false,
        }),
        TableRow,
        AlignedTableHeader,
        AlignedTableCell,
        TaskList,
        TaskItem.configure({
          nested: true,
        }),
        Image.configure({
          allowBase64: true,
          inline: true,
        }),
        Placeholder.configure({
          placeholder: () => t.blocks.placeholderEditor,
        }),
        FrontmatterExtension,
        GithubAlertExtension,
        MermaidExtension,
        MathInlineExtension,
        MathBlockExtension,
        RawHtmlBlockExtension,
        RawHtmlInlineExtension,
      ],
      editorProps: {
        attributes: {
          class: 'preview-prosemirror',
          'data-testid': 'preview-editor',
        },
        handleKeyDown(_view, event) {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            callbacksRef.current.onSaveShortcut?.();
            return true;
          }
          if (slashKeyHandlerRef.current) {
            return slashKeyHandlerRef.current(event);
          }
          return false;
        },
        handlePaste(_view, event) {
          const files = event.clipboardData?.files;
          if (files && Array.from(files).some((f) => f.type.startsWith('image/'))) {
            event.preventDefault();
            void handleImages(files);
            return true;
          }
          return false;
        },
        handleDrop(view, event) {
          const files = event.dataTransfer?.files;
          if (files && Array.from(files).some((f) => f.type.startsWith('image/'))) {
            event.preventDefault();
            const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
            void handleImages(files, coords?.pos);
            return true;
          }
          return false;
        },
      },
      onUpdate({ editor: ed, transaction }) {
        if (!transaction.docChanged || transaction.getMeta('externalSync')) {
          return;
        }
        const nextMd = proseMirrorDocToMarkdown(ed.getJSON());
        lastSyncedMdRef.current = nextMd;
        callbacksRef.current.onChange(nextMd);
      },
    });

    editorRef.current = editor;
    setEditorStateTick((n) => n + 1);

    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, [docKey]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) return;
    if (markdownText === lastSyncedMdRef.current) return;

    try {
      const docJson = markdownToProseMirrorDoc(markdownText);
      const pmDoc = editor.schema.nodeFromJSON(docJson);
      const tr = editor.state.tr
        .replaceWith(0, editor.state.doc.content.size, pmDoc.content)
        .setMeta('externalSync', true)
        .setMeta('addToHistory', false);
      editor.view.dispatch(tr);
      lastSyncedMdRef.current = markdownText;
    } catch {
      // Ignore transient incomplete markdown during rapid raw typing
    }
  }, [markdownText]);

  useImperativeHandle(ref, () => ({
    focus() {
      editorRef.current?.commands.focus();
    },
    setScrollRatio(ratio: number) {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const max = scroller.scrollHeight - scroller.clientHeight;
      if (max <= 0) return;
      suppressScrollRef.current = true;
      scroller.scrollTop = Math.max(0, Math.min(max, ratio * max));
      requestAnimationFrame(() => {
        suppressScrollRef.current = false;
      });
    },
    scrollToHeading(index: number, text: string) {
      const scroller = scrollerRef.current;
      const mount = mountRef.current;
      if (!scroller || !mount) return;
      const headings = Array.from(mount.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      const target =
        headings[index] ??
        headings.find((el) => el.textContent?.trim() === text.trim());
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    async insertImageFromFile(file: File) {
      const editor = editorRef.current;
      if (!editor) return;
      const dataUri = await fileToDataUri(file);
      const alt = sanitizeImageAlt(file.name);
      editor.chain().focus().setImage({ src: dataUri, alt }).run();
    },
    runAction(action: PreviewFormatAction) {
      const ed = editorRef.current;
      if (!ed) return;
      switch (action) {
        case 'bold':
          ed.chain().focus().toggleBold().run();
          break;
        case 'italic':
          ed.chain().focus().toggleItalic().run();
          break;
        case 'strike':
          ed.chain().focus().toggleStrike().run();
          break;
        case 'code':
          ed.chain().focus().toggleCode().run();
          break;
        case 'h1':
          ed.chain().focus().toggleHeading({ level: 1 }).run();
          break;
        case 'h2':
          ed.chain().focus().toggleHeading({ level: 2 }).run();
          break;
        case 'h3':
          ed.chain().focus().toggleHeading({ level: 3 }).run();
          break;
        case 'bulletList':
          ed.chain().focus().toggleBulletList().run();
          break;
        case 'orderedList':
          ed.chain().focus().toggleOrderedList().run();
          break;
        case 'taskList':
          ed.chain().focus().toggleTaskList().run();
          break;
        case 'quote':
          ed.chain().focus().toggleBlockquote().run();
          break;
        case 'codeBlock':
          ed.chain().focus().toggleCodeBlock().run();
          break;
        case 'table':
          ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
          break;
        case 'mermaid':
          ed
            .chain()
            .focus()
            .insertContent({
              type: 'mermaidBlock',
              attrs: { code: 'flowchart LR\n  A[Start] --> B[End]' },
            })
            .run();
          break;
        case 'mathInline': {
          const { from, to } = ed.state.selection;
          const selectedText = !ed.state.selection.empty
            ? ed.state.doc.textBetween(from, to, ' ').trim()
            : '';
          ed
            .chain()
            .focus()
            .deleteRange({ from, to })
            .insertContent({ type: 'mathInline', attrs: { latex: selectedText || 'E = mc^2' } })
            .run();
          break;
        }
        case 'mathBlock':
          ed
            .chain()
            .focus()
            .insertContent({
              type: 'mathBlock',
              attrs: { latex: '\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}' },
            })
            .run();
          break;
        case 'alert':
          ed
            .chain()
            .focus()
            .insertContent({
              type: 'githubAlert',
              attrs: { alertType: 'NOTE' },
              content: [{ type: 'paragraph' }],
            })
            .run();
          break;
        case 'divider':
          ed.chain().focus().setHorizontalRule().run();
          break;
      }
    },
  }));

  return (
    <div ref={containerRef} className="preview-editor-shell" data-editor-tick={editorStateTick}>
      <TableFloatingBar editor={editorRef.current} />
      <div
        ref={scrollerRef}
        className="preview-editor-scroller"
        onScroll={() => {
          if (suppressScrollRef.current) return;
          const scroller = scrollerRef.current;
          if (!scroller) return;
          const max = scroller.scrollHeight - scroller.clientHeight;
          if (max > 0) {
            callbacksRef.current.onScrollRatio?.(scroller.scrollTop / max);
          }
        }}
      >
        <div ref={mountRef} className="preview-editor-paper" />
      </div>
      <BubbleFormatMenu editor={editorRef.current} containerRef={containerRef} />
      <SlashCommandMenu
        editor={editorRef.current}
        containerRef={containerRef}
        onRequestImage={onRequestImageFile}
        keyHandlerRef={slashKeyHandlerRef}
      />
    </div>
  );
});
