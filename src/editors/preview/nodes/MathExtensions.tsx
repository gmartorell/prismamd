import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { renderLatexHtml } from '../../../renderers/katexRenderer';
import { useNodeUiContext } from '../nodeUiContext';

interface MathViewProps {
  latex: string;
  displayMode: boolean;
  onChange: (nextLatex: string) => void;
}

function MathView({ latex, displayMode, onChange }: MathViewProps) {
  const { t } = useNodeUiContext();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(latex);
  const [html, setHtml] = useState('');
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setDraft(latex);
  }, [latex]);

  useEffect(() => {
    let active = true;
    void renderLatexHtml(editing ? draft : latex, displayMode).then((res) => {
      if (active) setHtml(res.html);
    });
    return () => {
      active = false;
    };
  }, [latex, draft, editing, displayMode]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== latex) {
      onChange(draft);
    }
  };

  if (displayMode) {
    return (
      <div className="pm-math-block pm-interactive" contentEditable={false}>
        <div className="pm-block-header">
          <span className="pm-block-title">
            <span className="pm-block-badge pm-badge-math">LaTeX</span>
            <span>{t.blocks.mathBlockTitle}</span>
          </span>
          <button
            type="button"
            className="pm-mini-btn"
            onClick={() => {
              if (editing) commit();
              else setEditing(true);
            }}
          >
            {editing ? t.blocks.apply : t.blocks.editCode}
          </button>
        </div>

        {editing && (
          <div className="pm-math-editor-box">
            <textarea
              ref={(el) => {
                inputRef.current = el;
              }}
              className="pm-code-textarea"
              value={draft}
              rows={3}
              placeholder={t.blocks.latexPlaceholder}
              onInput={(e) => {
                const next = (e.currentTarget as HTMLTextAreaElement).value;
                setDraft(next);
                onChange(next);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  commit();
                }
              }}
            />
          </div>
        )}

        <div
          className="pm-math-display"
          onClick={() => {
            if (!editing) setEditing(true);
          }}
        >
          {html ? (
            <span dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <code className="pm-empty-hint">{latex || t.blocks.latexPlaceholder}</code>
          )}
        </div>
      </div>
    );
  }

  return (
    <span className="pm-math-inline-wrap pm-interactive" contentEditable={false}>
      <span
        className="pm-math-inline"
        onClick={(e) => {
          e.stopPropagation();
          setEditing((v) => !v);
        }}
        title={t.blocks.mathInlineTitle}
      >
        {html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <code>${latex}$</code>}
      </span>
      {editing && (
        <span className="pm-math-inline-popover">
          <input
            ref={(el) => {
              inputRef.current = el;
            }}
            type="text"
            className="pm-math-inline-input"
            value={draft}
            placeholder={t.blocks.latexPlaceholder}
            onInput={(e) => {
              const next = (e.currentTarget as HTMLInputElement).value;
              setDraft(next);
              onChange(next);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();
                commit();
              }
            }}
            onBlur={commit}
          />
        </span>
      )}
    </span>
  );
}

export const MathInlineExtension = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      latex: {
        default: 'E = mc^2',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="math-inline"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'math-inline' })];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('span');
      dom.className = 'pm-math-inline-host';
      let currentNode: PMNode = node;

      const updateLatex = (nextLatex: string) => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (typeof pos !== 'number') return;
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...currentNode.attrs,
            latex: nextLatex,
          }),
        );
      };

      const mount = (pmNode: PMNode) => {
        currentNode = pmNode;
        render(
          <MathView latex={String(pmNode.attrs.latex ?? '')} displayMode={false} onChange={updateLatex} />,
          dom,
        );
      };

      mount(node);

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type.name !== 'mathInline') return false;
          mount(updatedNode);
          return true;
        },
        stopEvent(event) {
          const target = event.target as HTMLElement | null;
          return Boolean(target?.closest('.pm-interactive, input, button'));
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

export const MathBlockExtension = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  defining: true,

  addAttributes() {
    return {
      latex: {
        default: '\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="math-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'math-block' })];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div');
      dom.className = 'pm-node-wrapper';
      let currentNode: PMNode = node;

      const updateLatex = (nextLatex: string) => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (typeof pos !== 'number') return;
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...currentNode.attrs,
            latex: nextLatex,
          }),
        );
      };

      const mount = (pmNode: PMNode) => {
        currentNode = pmNode;
        render(
          <MathView latex={String(pmNode.attrs.latex ?? '')} displayMode={true} onChange={updateLatex} />,
          dom,
        );
      };

      mount(node);

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type.name !== 'mathBlock') return false;
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
