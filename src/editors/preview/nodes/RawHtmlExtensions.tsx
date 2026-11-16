import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { render } from 'preact';
import { useNodeUiContext } from '../nodeUiContext';

function RawHtmlBlockView({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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
      value: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="raw-html-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'raw-html-block' })];
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

      const mount = (pmNode: PMNode) => {
        currentNode = pmNode;
        render(<RawHtmlBlockView value={String(pmNode.attrs.value ?? '')} onChange={updateVal} />, dom);
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
      value: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'code[data-type="raw-html-inline"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'code',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'raw-html-inline',
        class: 'pm-rawhtml-inline',
      }),
      String(node.attrs.value ?? ''),
    ];
  },
});
