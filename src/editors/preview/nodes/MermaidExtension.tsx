import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { renderMermaidSvg } from '../../../renderers/mermaidRenderer';
import { useNodeUiContext } from '../nodeUiContext';

interface MermaidCardProps {
  code: string;
  onChange: (nextCode: string) => void;
}

function MermaidCard({ code, onChange }: MermaidCardProps) {
  const { theme, t } = useNodeUiContext();
  const [editing, setEditing] = useState(false);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      const res = await renderMermaidSvg(code, theme);
      if (!active) return;
      if (res.error) {
        setError(res.error);
      } else {
        setError(undefined);
        setSvg(res.svg);
      }
    }, editing ? 180 : 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [code, theme, editing]);

  return (
    <div className="pm-mermaid-card pm-interactive" contentEditable={false}>
      <div className="pm-block-header">
        <span className="pm-block-title">
          <span className="pm-block-badge pm-badge-mermaid">Mermaid</span>
          <span>{t.blocks.mermaidTitle}</span>
        </span>
        <button
          type="button"
          className="pm-mini-btn"
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? t.blocks.preview : t.blocks.editCode}
        </button>
      </div>

      {editing && (
        <textarea
          className="pm-code-textarea"
          value={code}
          rows={Math.max(4, Math.min(16, code.split('\n').length + 1))}
          onInput={(e) => onChange((e.currentTarget as HTMLTextAreaElement).value)}
        />
      )}

      <div
        className="pm-mermaid-preview"
        onClick={() => {
          if (!editing) setEditing(true);
        }}
        title={!editing ? t.blocks.editCode : undefined}
      >
        {error ? (
          <div className="pm-render-error">
            <strong>{t.blocks.mermaidError}:</strong> {error}
          </div>
        ) : svg ? (
          <div className="pm-mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <div className="pm-empty-hint">{t.blocks.mermaidEmpty}</div>
        )}
      </div>
    </div>
  );
}

export const MermaidExtension = Node.create({
  name: 'mermaidBlock',
  group: 'block',
  atom: true,
  defining: true,

  addAttributes() {
    return {
      code: {
        default: 'flowchart LR\n  A[Start] --> B[End]',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="mermaid-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'mermaid-block' })];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div');
      dom.className = 'pm-node-wrapper';
      let currentNode: PMNode = node;

      const updateCode = (nextCode: string) => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (typeof pos !== 'number') return;
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...currentNode.attrs,
            code: nextCode,
          }),
        );
      };

      const mount = (pmNode: PMNode) => {
        currentNode = pmNode;
        render(
          <MermaidCard code={String(pmNode.attrs.code ?? '')} onChange={updateCode} />,
          dom,
        );
      };

      mount(node);

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type.name !== 'mermaidBlock') return false;
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
