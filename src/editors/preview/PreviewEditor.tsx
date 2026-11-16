import { Editor, type JSONContent } from '@tiptap/core';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Document from '@tiptap/extension-document';
import Image from '@tiptap/extension-image';
import { OrderedList, TaskItem, TaskList } from '@tiptap/extension-list';
import Placeholder from '@tiptap/extension-placeholder';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import type { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import { forwardRef } from 'preact/compat';
import { useEffect, useImperativeHandle, useRef, useState } from 'preact/hooks';
import { useI18n } from '../../i18n';
import { markdownToProseMirrorDoc, proseMirrorDocToMarkdown } from '../../markdown/bridge';
import { fileToDataUri, sanitizeImageAlt } from '../../markdown/imageDataUri';
import type { ThemeMode } from '../../renderers/mermaidRenderer';
import { BubbleFormatMenu, extractSelectionLatex } from './BubbleFormatMenu';
import { getNodeUiContext, subscribeNodeUiContext, updateNodeUiContext } from './nodeUiContext';
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

const CODE_BLOCK_LANGUAGES = [
  'typescript',
  'javascript',
  'python',
  'bash',
  'json',
  'html',
  'css',
  'sql',
  'markdown',
  'yaml',
  'rust',
  'go',
  'java',
  'c',
  'cpp',
] as const;

export const PrismaDocument = Document.extend({
  content: 'frontmatter? block+',
});

function normalizeDocJsonForSchema(docJson: JSONContent): JSONContent {
  const rawContent = Array.isArray(docJson.content) ? docJson.content : [];
  const frontmatterNodes = rawContent.filter((n) => n.type === 'frontmatter');
  const blockNodes = rawContent.filter((n) => n.type !== 'frontmatter');
  const nextContent: JSONContent[] = [];

  if (frontmatterNodes.length > 0) {
    nextContent.push(frontmatterNodes[0]);
  }
  if (blockNodes.length > 0) {
    nextContent.push(...blockNodes);
  } else {
    nextContent.push({ type: 'paragraph' });
  }

  return {
    ...docJson,
    type: 'doc',
    content: nextContent,
  };
}

const InteractiveCodeBlock = CodeBlockLowlight.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      meta: {
        default: null,
        rendered: false,
      },
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      let currentNode: PMNode = node;
      let copied = false;
      let copyTimer: number | null = null;

      const dom = document.createElement('div');
      dom.className = 'pm-code-block';

      const header = document.createElement('div');
      header.className = 'pm-code-block-header';
      header.contentEditable = 'false';

      const select = document.createElement('select');
      select.className = 'pm-code-lang-select';

      const autoOption = document.createElement('option');
      autoOption.value = '';
      select.appendChild(autoOption);

      for (const lang of CODE_BLOCK_LANGUAGES) {
        const opt = document.createElement('option');
        opt.value = lang;
        opt.textContent = lang;
        select.appendChild(opt);
      }

      let customOption: HTMLOptionElement | null = null;

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'pm-code-copy-btn';

      const pre = document.createElement('pre');
      const contentDOM = document.createElement('code');
      pre.appendChild(contentDOM);

      header.append(select, copyBtn);
      dom.append(header, pre);

      const syncUi = (pmNode: PMNode) => {
        const { t } = getNodeUiContext();
        const rawLang = typeof pmNode.attrs.language === 'string' ? pmNode.attrs.language.trim() : '';

        autoOption.textContent = t.blocks.codeLanguageAuto;
        select.setAttribute('aria-label', t.blocks.codeLanguageAria);

        if (rawLang && !(CODE_BLOCK_LANGUAGES as readonly string[]).includes(rawLang)) {
          if (!customOption) {
            customOption = document.createElement('option');
            customOption.dataset.customLang = 'true';
            select.appendChild(customOption);
          }
          customOption.value = rawLang;
          customOption.textContent = rawLang;
        } else if (customOption) {
          customOption.remove();
          customOption = null;
        }

        select.value = rawLang;
        const nextCodeClass = rawLang ? `language-${rawLang}` : '';
        if (contentDOM.className !== nextCodeClass) {
          contentDOM.className = nextCodeClass;
        }

        copyBtn.textContent = copied ? t.blocks.codeCopied : t.blocks.copyCode;
        if (copied) {
          copyBtn.dataset.copied = 'true';
        } else {
          delete copyBtn.dataset.copied;
        }
      };

      select.addEventListener('change', () => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (typeof pos !== 'number' || editor.isDestroyed) return;
        const nextLang = select.value || '';
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...currentNode.attrs,
            language: nextLang,
          }),
        );
      });

      copyBtn.addEventListener('click', () => {
        const text = currentNode.textContent;
        void navigator.clipboard?.writeText(text).catch(() => undefined);
        copied = true;
        syncUi(currentNode);
        if (copyTimer !== null) {
          window.clearTimeout(copyTimer);
        }
        copyTimer = window.setTimeout(() => {
          copyTimer = null;
          copied = false;
          syncUi(currentNode);
        }, 1500);
      });

      const unsubscribe = subscribeNodeUiContext(() => syncUi(currentNode));
      syncUi(node);

      return {
        dom,
        contentDOM,
        update(updatedNode) {
          if (updatedNode.type.name !== 'codeBlock') return false;
          currentNode = updatedNode;
          syncUi(updatedNode);
          return true;
        },
        stopEvent(event) {
          const target = event.target as HTMLElement | null;
          return Boolean(target?.closest('.pm-code-block-header'));
        },
        ignoreMutation(mutation) {
          if (mutation.type === 'attributes' && mutation.target === contentDOM) {
            return true;
          }
          return !contentDOM.contains(mutation.target as globalThis.Node);
        },
        destroy() {
          if (copyTimer !== null) {
            window.clearTimeout(copyTimer);
            copyTimer = null;
          }
          unsubscribe();
        },
      };
    };
  },
});

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

const MixedOrderedList = OrderedList.extend({
  content: '(listItem | taskItem)+',
});

export function createPreviewExtensions() {
  return [
    PrismaDocument,
    StarterKit.configure({
      document: false,
      codeBlock: false,
      orderedList: false,
      underline: false,
      link: {
        openOnClick: false,
        autolink: true,
      },
    }),
    MixedOrderedList,
    InteractiveCodeBlock.configure({
      lowlight,
      defaultLanguage: null,
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
      placeholder: () => getNodeUiContext().t.blocks.placeholderEditor,
    }),
    FrontmatterExtension,
    GithubAlertExtension,
    MermaidExtension,
    MathInlineExtension,
    MathBlockExtension,
    RawHtmlBlockExtension,
    RawHtmlInlineExtension,
  ];
}

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
  const suppressScrollTimerRef = useRef<number | null>(null);
  const slashKeyHandlerRef = useRef<((event: KeyboardEvent) => boolean) | null>(null);

  const callbacksRef = useRef({ onChange, onScrollRatio, onSaveShortcut });
  callbacksRef.current = { onChange, onScrollRatio, onSaveShortcut };

  useEffect(() => {
    updateNodeUiContext(theme, t);
    const editor = editorRef.current;
    if (editor && !editor.isDestroyed) {
      editor.view.dispatch(
        editor.state.tr.setMeta('uiContextSync', true).setMeta('addToHistory', false),
      );
    }
  }, [theme, t]);

  useEffect(() => {
    return () => {
      if (suppressScrollTimerRef.current !== null) {
        window.clearTimeout(suppressScrollTimerRef.current);
        suppressScrollTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const mountEl = mountRef.current;
    if (!mountEl) return;

    updateNodeUiContext(theme, t);
    let initialDoc: JSONContent;
    try {
      initialDoc = normalizeDocJsonForSchema(markdownToProseMirrorDoc(markdownText));
    } catch {
      initialDoc = { type: 'doc', content: [{ type: 'paragraph' }] };
    }
    lastSyncedMdRef.current = markdownText;

    const handleImages = async (files: FileList | File[], insertPos?: number) => {
      const images = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (images.length === 0) return;

      const prepared: Array<{ src: string; alt: string }> = [];
      for (const imgFile of images) {
        const dataUri = await fileToDataUri(imgFile);
        const alt = sanitizeImageAlt(imgFile.name, getNodeUiContext().t.toolbar.defaultImageAlt);
        prepared.push({ src: dataUri, alt });
      }

      const currentEditor = editorRef.current;
      if (!currentEditor || currentEditor.isDestroyed || prepared.length === 0) return;

      if (typeof insertPos === 'number') {
        const clampedPos = Math.max(0, Math.min(currentEditor.state.doc.content.size, insertPos));
        currentEditor
          .chain()
          .focus()
          .insertContentAt(
            clampedPos,
            prepared.map((img) => ({ type: 'image', attrs: img })),
          )
          .run();
      } else {
        for (const img of prepared) {
          currentEditor.chain().focus().setImage(img).run();
        }
      }
    };

    const editor = new Editor({
      element: mountEl,
      content: initialDoc,
      extensions: createPreviewExtensions(),
      editorProps: {
        attributes: {
          class: 'preview-prosemirror',
          'data-testid': 'preview-editor',
        },
        handleKeyDown(_view, event) {
          if (
            (event.ctrlKey || event.metaKey) &&
            !event.shiftKey &&
            !event.altKey &&
            event.key.toLowerCase() === 's'
          ) {
            event.preventDefault();
            event.stopPropagation();
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
      const docJson = normalizeDocJsonForSchema(markdownToProseMirrorDoc(markdownText));
      const nextDoc = editor.schema.nodeFromJSON(docJson);
      const curDoc = editor.state.doc;

      const diffStart = curDoc.content.findDiffStart(nextDoc.content);
      if (diffStart === null) {
        lastSyncedMdRef.current = markdownText;
        return;
      }

      const diffEnd = curDoc.content.findDiffEnd(nextDoc.content);
      let tr = editor.state.tr;
      if (diffEnd) {
        let { a: endA, b: endB } = diffEnd;
        const overlap = diffStart - Math.min(endA, endB);
        if (overlap > 0) {
          endA += overlap;
          endB += overlap;
        }
        tr = tr.replace(diffStart, endA, nextDoc.slice(diffStart, endB));
        if (!tr.doc.eq(nextDoc)) {
          tr = editor.state.tr.replaceWith(0, curDoc.content.size, nextDoc.content);
        }
      } else {
        tr = tr.replaceWith(0, curDoc.content.size, nextDoc.content);
      }

      tr.setMeta('externalSync', true).setMeta('addToHistory', false);
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
        suppressScrollRef.current = true;
        if (suppressScrollTimerRef.current !== null) {
          window.clearTimeout(suppressScrollTimerRef.current);
        }
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        suppressScrollTimerRef.current = window.setTimeout(() => {
          suppressScrollRef.current = false;
          suppressScrollTimerRef.current = null;
        }, 650);
      }
    },
    async insertImageFromFile(file: File) {
      const dataUri = await fileToDataUri(file);
      const editor = editorRef.current;
      if (!editor || editor.isDestroyed) return;
      const alt = sanitizeImageAlt(file.name, getNodeUiContext().t.toolbar.defaultImageAlt);
      editor.chain().focus().setImage({ src: dataUri, alt }).run();
    },
    runAction(action: PreviewFormatAction) {
      const ed = editorRef.current;
      if (!ed || ed.isDestroyed) return;
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
          ed.chain().focus().toggleCodeBlock({ language: '' }).run();
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
          const selectedText = extractSelectionLatex(ed);
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
          if (ed.isActive('githubAlert')) {
            ed.chain().focus().lift('githubAlert').run();
          } else if (!ed.state.selection.empty) {
            ed.chain().focus().wrapIn('githubAlert', { alertType: 'NOTE' }).run();
          } else {
            ed
              .chain()
              .focus()
              .insertContent({
                type: 'githubAlert',
                attrs: { alertType: 'NOTE' },
                content: [{ type: 'paragraph' }],
              })
              .run();
          }
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
