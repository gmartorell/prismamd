import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { GithubAlertKind } from '../../../i18n/types';
import { getNodeUiContext, subscribeNodeUiContext } from '../nodeUiContext';

const ALERT_KINDS: GithubAlertKind[] = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'];

const ALERT_ICONS: Record<GithubAlertKind, string> = {
  NOTE: 'ℹ',
  TIP: '💡',
  IMPORTANT: '❗',
  WARNING: '⚠',
  CAUTION: '🛑',
};

function normalizeKind(raw: unknown): GithubAlertKind {
  const s = String(raw ?? 'NOTE').toUpperCase();
  return ALERT_KINDS.includes(s as GithubAlertKind) ? (s as GithubAlertKind) : 'NOTE';
}

export const GithubAlertExtension = Node.create({
  name: 'githubAlert',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      alertType: {
        default: 'NOTE',
        parseHTML: (element) => normalizeKind(element.getAttribute('data-alert-type')),
        renderHTML: (attributes) => ({ 'data-alert-type': normalizeKind(attributes.alertType) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="github-alert"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'github-alert' }), 0];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      let currentNode: PMNode = node;

      const dom = document.createElement('div');
      dom.className = 'pm-github-alert';

      const header = document.createElement('div');
      header.className = 'pm-github-alert-header';
      header.contentEditable = 'false';

      const iconSpan = document.createElement('span');
      iconSpan.className = 'pm-github-alert-icon';

      const select = document.createElement('select');
      select.className = 'pm-github-alert-select';
      for (const kind of ALERT_KINDS) {
        const option = document.createElement('option');
        option.value = kind;
        option.textContent = kind;
        select.appendChild(option);
      }

      const contentDOM = document.createElement('div');
      contentDOM.className = 'pm-github-alert-body';

      header.append(iconSpan, select);
      dom.append(header, contentDOM);

      const syncHeader = (pmNode: PMNode) => {
        const kind = normalizeKind(pmNode.attrs.alertType);
        const { t } = getNodeUiContext();
        dom.dataset.alertType = kind;
        iconSpan.textContent = ALERT_ICONS[kind];
        select.value = kind;
        Array.from(select.options).forEach((opt) => {
          const k = opt.value as GithubAlertKind;
          opt.textContent = t.blocks.alerts[k] ?? k;
        });
      };

      select.addEventListener('change', () => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (typeof pos !== 'number') return;
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...currentNode.attrs,
            alertType: normalizeKind(select.value),
          }),
        );
      });

      const unsubscribe = subscribeNodeUiContext(() => syncHeader(currentNode));
      syncHeader(node);

      return {
        dom,
        contentDOM,
        update(updatedNode) {
          if (updatedNode.type.name !== 'githubAlert') return false;
          currentNode = updatedNode;
          syncHeader(updatedNode);
          return true;
        },
        stopEvent(event) {
          const target = event.target as HTMLElement | null;
          return Boolean(target?.closest('.pm-github-alert-header'));
        },
        destroy() {
          unsubscribe();
        },
      };
    };
  },
});
