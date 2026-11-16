import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { render } from 'preact';
import { useNodeUiContext } from '../nodeUiContext';

const INTERNAL_RAW_TOKEN =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

function RawHtmlBlockView({
  value,
  onChange,
  onEscape,
}: {
  value: string;
  onChange: (v: string) => void;
  onEscape?: () => void;
}) {
  const { t } = useNodeUiContext();
  return (
    <div className="pm-rawhtml-card pm-interactive" contentEditable={false}>
      <div className="pm-block-header">
        <span className="pm-block-title">
          <span className="pm-block-badge">HTML</span>
          <span>{t.blocks.rawHtmlTitle}</span>
        </span>
      </div>
      <textarea
        className="pm-code-textarea"
        value={value}
        rows={Math.max(2, Math.min(8, value.split('\n').length))}
        onInput={(e) => onChange((e.currentTarget as HTMLTextAreaElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onEscape?.();
          }
        }}
      />
    </div>
  );
}

export const RawHtmlBlockExtension = Node.create({
  name: 'rawHtmlBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      value: {
        default: '',
        rendered: false,
        parseHTML: (element) =>
          element.getAttribute('data-internal-raw') === INTERNAL_RAW_TOKEN
            ? (element.getAttribute('data-raw-value') ?? '')
            : null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="raw-html-block"]',
        priority: 60,
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement) || element.getAttribute('data-internal-raw') !== INTERNAL_RAW_TOKEN) {
            return false;
          }
          return {
            value: element.getAttribute('data-raw-value') ?? '',
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const val = String(node.attrs.value ?? '');
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'raw-html-block',
        'data-internal-raw': INTERNAL_RAW_TOKEN,
        'data-raw-value': val,
      }),
      val,
    ];
  },

  renderText({ node }) {
    return String(node.attrs.value ?? '');
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div');
      dom.className = 'pm-node-wrapper';
      let currentNode: PMNode = node;

      const updateVal = (next: string) => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (typeof pos !== 'number') return;
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...currentNode.attrs,
            value: next,
          }),
        );
      };

      const refocusEditor = () => {
        if (!editor.isDestroyed) {
          editor.commands.focus();
        }
      };

      const mount = (pmNode: PMNode) => {
        currentNode = pmNode;
        render(
          <RawHtmlBlockView
            value={String(pmNode.attrs.value ?? '')}
            onChange={updateVal}
            onEscape={refocusEditor}
          />,
          dom,
        );
      };
      mount(node);

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type.name !== 'rawHtmlBlock') return false;
          mount(updatedNode);
          return true;
        },
        stopEvent(event) {
          const target = event.target as HTMLElement | null;
          return Boolean(target?.closest('.pm-interactive, textarea'));
        },
        ignoreMutation: () => true,
        destroy: () => render(null, dom),
      };
    };
  },
});

export const RawHtmlInlineExtension = Node.create({
  name: 'rawHtmlInline',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      value: {
        default: '',
        rendered: false,
        parseHTML: (element) =>
          element.getAttribute('data-internal-raw') === INTERNAL_RAW_TOKEN
            ? (element.getAttribute('data-raw-value') ?? '')
            : null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'code[data-type="raw-html-inline"]',
        priority: 60,
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement) || element.getAttribute('data-internal-raw') !== INTERNAL_RAW_TOKEN) {
            return false;
          }
          return {
            value: element.getAttribute('data-raw-value') ?? '',
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const val = String(node.attrs.value ?? '');
    return [
      'code',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'raw-html-inline',
        'data-internal-raw': INTERNAL_RAW_TOKEN,
        'data-raw-value': val,
        class: 'pm-rawhtml-inline',
      }),
      val,
    ];
  },

  renderText({ node }) {
    return String(node.attrs.value ?? '');
  },
});
