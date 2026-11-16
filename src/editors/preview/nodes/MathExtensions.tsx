import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { renderLatexHtml } from '../../../renderers/katexRenderer';
import { useNodeUiContext } from '../nodeUiContext';

interface MathViewProps {
  latex: string;
  displayMode: boolean;
  onChange: (nextLatex: string) => void;
  onDelete?: () => void;
  onRefocusEditor?: () => void;
}

function MathView({ latex, displayMode, onChange, onDelete, onRefocusEditor }: MathViewProps) {
  const { t } = useNodeUiContext();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(latex);
  const [html, setHtml] = useState('');
  const [alignRight, setAlignRight] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const draftRef = useRef(latex);
  const skipBlurCommitRef = useRef(false);

  useEffect(() => {
    if (!editing) {
      draftRef.current = latex;
      setDraft(latex);
    }
  }, [latex, editing]);

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

  const openEditing = () => {
    skipBlurCommitRef.current = false;
    draftRef.current = latex;
    setDraft(latex);
    if (!displayMode && wrapRef.current) {
      const rect = wrapRef.current.getBoundingClientRect();
      const container = wrapRef.current.closest('.preview-editor-shell');
      const rightLimit = container ? container.getBoundingClientRect().right : window.innerWidth;
      setAlignRight(rect.left + 226 > rightLimit);
    }
    setEditing(true);
  };

  const commit = (shouldRefocus: boolean) => {
    if (skipBlurCommitRef.current) return;
    skipBlurCommitRef.current = true;
    const finalValue = draftRef.current;
    setEditing(false);
    if (!displayMode && finalValue.trim() === '') {
      onDelete?.();
    } else if (finalValue !== latex) {
      onChange(finalValue);
    }
    if (shouldRefocus) {
      onRefocusEditor?.();
    }
  };

  const cancel = () => {
    skipBlurCommitRef.current = true;
    draftRef.current = latex;
    setDraft(latex);
    setEditing(false);
    onRefocusEditor?.();
  };

  if (displayMode) {
    return (
      <div className="pm-math-block pm-interactive" contentEditable={false}>
        <div className="pm-block-header">
          <span className="pm-block-title">
            <span className="pm-block-badge pm-badge-math">LaTeX</span>
            <span>{t.blocks.mathBlockTitle}</span>
          </span>
          <span style={{ display: 'inline-flex', gap: '4px' }}>
            {editing && (
              <button
                type="button"
                className="pm-mini-btn"
                onMouseDown={(e) => e.preventDefault()}
                onClick={cancel}
              >
                {t.blocks.cancel}
              </button>
            )}
            <button
              type="button"
              className="pm-mini-btn"
              onMouseDown={(e) => {
                if (editing) e.preventDefault();
              }}
              onClick={() => {
                if (editing) commit(true);
                else openEditing();
              }}
            >
              {editing ? t.blocks.apply : t.blocks.editCode}
            </button>
          </span>
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
                draftRef.current = next;
                setDraft(next);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  cancel();
                } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  e.stopPropagation();
                  commit(true);
                }
              }}
              onBlur={() => {
                if (skipBlurCommitRef.current) {
                  skipBlurCommitRef.current = false;
                  return;
                }
                commit(false);
              }}
            />
          </div>
        )}

        <div
          className="pm-math-display"
          onClick={() => {
            if (!editing) openEditing();
          }}
        >
          {html ? (
            <span dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <code className="pm-empty-hint">{latex.trim() || t.blocks.latexPlaceholder}</code>
          )}
        </div>
      </div>
    );
  }

  return (
    <span ref={wrapRef} className="pm-math-inline-wrap pm-interactive" contentEditable={false}>
      <span
        className="pm-math-inline"
        onMouseDown={(e) => {
          if (editing) {
            e.preventDefault();
          }
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (editing) {
            commit(true);
          } else {
            openEditing();
          }
        }}
        title={t.blocks.mathInlineTitle}
      >
        {html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <code>${latex}$</code>}
      </span>
      {editing && (
        <span
          className="pm-math-inline-popover"
          style={alignRight ? { left: 'auto', right: '0' } : undefined}
        >
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
              draftRef.current = next;
              setDraft(next);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                commit(true);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                cancel();
              }
            }}
            onBlur={() => {
              if (skipBlurCommitRef.current) {
                skipBlurCommitRef.current = false;
                return;
              }
              commit(false);
            }}
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

  renderHTML({ node, HTMLAttributes }) {
    const val = String(node.attrs.latex ?? '');
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'math-inline' }), `$${val}$`];
  },

  renderText({ node }) {
    return `$${String(node.attrs.latex ?? '')}$`;
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('span');
      dom.className = 'pm-math-inline-host';
      let currentNode: PMNode = node;

      const updateLatex = (nextLatex: string) => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (typeof pos !== 'number') return;
        const trimmed = nextLatex.trim();
        if (!trimmed) {
          deleteSelf();
          return;
        }
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...currentNode.attrs,
            latex: nextLatex,
          }),
        );
      };

      const deleteSelf = () => {
        if (editor.isDestroyed) return;
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (typeof pos !== 'number') return;
        const nodeAtPos = editor.state.doc.nodeAt(pos);
        if (!nodeAtPos || nodeAtPos.type.name !== 'mathInline') return;
        editor.view.dispatch(editor.state.tr.delete(pos, pos + nodeAtPos.nodeSize));
      };

      const refocusEditor = () => {
        if (editor.isDestroyed) return;
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (typeof pos === 'number' && pos >= 0 && pos <= editor.state.doc.content.size) {
          const nodeAtPos = editor.state.doc.nodeAt(pos);
          const targetPos =
            nodeAtPos?.type.name === 'mathInline'
              ? Math.min(editor.state.doc.content.size, pos + nodeAtPos.nodeSize)
              : pos;
          const tr = editor.state.tr
            .setSelection(TextSelection.near(editor.state.doc.resolve(targetPos)))
            .setMeta('addToHistory', false);
          editor.view.dispatch(tr);
        }
        editor.view.focus();
      };

      const mount = (pmNode: PMNode) => {
        currentNode = pmNode;
        render(
          <MathView
            latex={String(pmNode.attrs.latex ?? '')}
            displayMode={false}
            onChange={updateLatex}
            onDelete={deleteSelf}
            onRefocusEditor={refocusEditor}
          />,
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

  renderHTML({ node, HTMLAttributes }) {
    const val = String(node.attrs.latex ?? '');
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'math-block' }), `$$\n${val}\n$$`];
  },

  renderText({ node }) {
    return `$$\n${String(node.attrs.latex ?? '')}\n$$`;
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

      const refocusEditor = () => {
        if (!editor.isDestroyed) {
          editor.commands.focus();
        }
      };

      const mount = (pmNode: PMNode) => {
        currentNode = pmNode;
        render(
          <MathView
            latex={String(pmNode.attrs.latex ?? '')}
            displayMode={true}
            onChange={updateLatex}
            onRefocusEditor={refocusEditor}
          />,
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
