import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { renderMermaidSvg } from '../../../renderers/mermaidRenderer';
import { useNodeUiContext } from '../nodeUiContext';

interface MermaidCardProps {
  code: string;
  onChange: (nextCode: string) => void;
  onRefocusEditor?: () => void;
}

function MermaidCard({ code, onChange, onRefocusEditor }: MermaidCardProps) {
  const { theme, t } = useNodeUiContext();
  const [editing, setEditing] = useState(false);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isInitialRenderRef = useRef(true);
  const prevCodeRef = useRef(code);

  useEffect(() => {
    const trimmed = code.trim();
    if (!trimmed) {
      prevCodeRef.current = code;
      isInitialRenderRef.current = false;
      setSvg('');
      setError(undefined);
      return;
    }

    const codeChanged = prevCodeRef.current !== code;
    prevCodeRef.current = code;
    const delay = isInitialRenderRef.current ? 0 : codeChanged ? 180 : 0;
    isInitialRenderRef.current = false;

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
    }, delay);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [code, theme]);

  useEffect(() => {
    if (editing) {
      textareaRef.current?.focus();
    }
  }, [editing]);

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
          onClick={() => {
            if (editing) {
              setEditing(false);
              onRefocusEditor?.();
            } else {
              setEditing(true);
            }
          }}
        >
          {editing ? t.blocks.preview : t.blocks.editCode}
        </button>
      </div>

      {editing && (
        <textarea
          ref={(el) => {
            textareaRef.current = el;
          }}
          className="pm-code-textarea"
          value={code}
          rows={Math.max(4, Math.min(16, code.split('\n').length + 1))}
          onInput={(e) => onChange((e.currentTarget as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setEditing(false);
              onRefocusEditor?.();
            }
          }}
        />
      )}

      <div
        className="pm-mermaid-preview"
        onClick={(e) => {
          if ((e.target as HTMLElement | null)?.closest('a')) {
            e.preventDefault();
          }
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

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'mermaid-block' }),
      String(node.attrs.code ?? ''),
    ];
  },

  renderText({ node }) {
    return `\`\`\`mermaid\n${String(node.attrs.code ?? '')}\n\`\`\``;
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

      const refocusEditor = () => {
        if (!editor.isDestroyed) {
          editor.commands.focus();
        }
      };

      const mount = (pmNode: PMNode) => {
        currentNode = pmNode;
        render(
          <MermaidCard
            code={String(pmNode.attrs.code ?? '')}
            onChange={updateCode}
            onRefocusEditor={refocusEditor}
          />,
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
