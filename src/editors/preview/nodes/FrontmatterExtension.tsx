import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { useNodeUiContext } from '../nodeUiContext';

interface FrontmatterCardProps {
  value: string;
  onChange: (next: string) => void;
  onEscape?: () => void;
}

function FrontmatterCard({ value, onChange, onEscape }: FrontmatterCardProps) {
  const { t } = useNodeUiContext();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="pm-frontmatter-card pm-interactive" contentEditable={false}>
      <div className="pm-block-header">
        <button
          type="button"
          className="pm-block-toggle"
          onClick={() => setCollapsed((v) => !v)}
        >
          <span className="pm-block-badge">YAML</span>
          <span>{t.blocks.frontmatterTitle}</span>
          <span className="pm-chevron">{collapsed ? '▸' : '▾'}</span>
        </button>
      </div>
      {!collapsed && (
        <textarea
          className="pm-frontmatter-textarea"
          value={value}
          rows={Math.max(2, Math.min(10, value.split('\n').length))}
          placeholder={t.blocks.frontmatterPlaceholder}
          onInput={(e) => onChange((e.currentTarget as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onEscape?.();
            }
          }}
        />
      )}
    </div>
  );
}

export const FrontmatterExtension = Node.create({
  name: 'frontmatter',
  atom: true,
  defining: true,

  addAttributes() {
    return {
      value: {
        default: '',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="frontmatter"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const val = String(node.attrs.value ?? '');
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'frontmatter' }), `---\n${val}\n---`];
  },

  renderText({ node }) {
    return `---\n${String(node.attrs.value ?? '')}\n---`;
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div');
      dom.className = 'pm-node-wrapper';
      let currentNode: PMNode = node;

      const updateValue = (nextValue: string) => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (typeof pos !== 'number') return;
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...currentNode.attrs,
            value: nextValue,
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
          <FrontmatterCard
            value={String(pmNode.attrs.value ?? '')}
            onChange={updateValue}
            onEscape={refocusEditor}
          />,
          dom,
        );
      };

      mount(node);

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type.name !== 'frontmatter') return false;
          mount(updatedNode);
          return true;
        },
        stopEvent(event) {
          const target = event.target as HTMLElement | null;
          return Boolean(target?.closest('.pm-interactive, textarea, button'));
        },
        ignoreMutation() {
          return true;
        },
        destroy() {
          render(null, dom);
        },
      };
    };
  },
});
