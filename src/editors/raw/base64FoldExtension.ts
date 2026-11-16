import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { estimateBase64Bytes, formatByteSize } from '../../markdown/imageDataUri';

export interface Base64UriMatch {
  from: number;
  to: number;
  mime: string;
  approxBytes: number;
}

export interface Base64FoldLabels {
  expand: string;
  collapse: string;
  imageLabel: string;
}

const DATA_URI_LINE_REGEX = /data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]{120,})/g;

export function findBase64DataUriRanges(lineText: string, lineFrom: number): Base64UriMatch[] {
  const matches: Base64UriMatch[] = [];
  DATA_URI_LINE_REGEX.lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = DATA_URI_LINE_REGEX.exec(lineText)) !== null) {
    const mime = m[1].toLowerCase();
    const payload = m[2];
    const from = lineFrom + m.index;
    const to = from + m[0].length;
    matches.push({
      from,
      to,
      mime,
      approxBytes: estimateBase64Bytes(payload),
    });
  }

  return matches;
}

export const toggleBase64ExpandEffect = StateEffect.define<number>();

const expandedBase64Field = StateField.define<Set<number>>({
  create() {
    return new Set<number>();
  },
  update(value, tr) {
    let next = value;

    if (tr.docChanged && next.size > 0) {
      const mapped = new Set<number>();
      for (const pos of next) {
        if (pos <= tr.startState.doc.length) {
          mapped.add(tr.changes.mapPos(pos, 1));
        }
      }
      next = mapped;
    }

    for (const effect of tr.effects) {
      if (effect.is(toggleBase64ExpandEffect)) {
        const clone = new Set(next);
        if (clone.has(effect.value)) {
          clone.delete(effect.value);
        } else {
          clone.add(effect.value);
        }
        next = clone;
      }
    }

    return next;
  },
});

class Base64ChipWidget extends WidgetType {
  constructor(
    private readonly from: number,
    private readonly mime: string,
    private readonly approxBytes: number,
    private readonly getLabels: () => Base64FoldLabels,
  ) {
    super();
  }

  eq(other: Base64ChipWidget): boolean {
    return (
      other.from === this.from &&
      other.mime === this.mime &&
      other.approxBytes === this.approxBytes
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const labels = this.getLabels();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cm-base64-chip';
    btn.setAttribute('aria-label', `${labels.imageLabel} ${this.mime} ${formatByteSize(this.approxBytes)}`);

    const icon = document.createElement('span');
    icon.className = 'cm-base64-chip-badge';
    icon.textContent = `base64/${this.mime}`;

    const size = document.createElement('span');
    size.className = 'cm-base64-chip-size';
    size.textContent = formatByteSize(this.approxBytes);

    const action = document.createElement('span');
    action.className = 'cm-base64-chip-action';
    action.textContent = `[${labels.expand}]`;

    btn.append(icon, size, action);
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({
        effects: toggleBase64ExpandEffect.of(this.from),
      });
    });
    return btn;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class Base64CollapseWidget extends WidgetType {
  constructor(
    private readonly from: number,
    private readonly getLabels: () => Base64FoldLabels,
  ) {
    super();
  }

  eq(other: Base64CollapseWidget): boolean {
    return other.from === this.from;
  }

  toDOM(view: EditorView): HTMLElement {
    const labels = this.getLabels();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cm-base64-chip cm-base64-chip-collapse';
    btn.textContent = `[${labels.collapse}]`;
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({
        effects: toggleBase64ExpandEffect.of(this.from),
      });
    });
    return btn;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function buildBase64Decorations(
  view: EditorView,
  getLabels: () => Base64FoldLabels,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const expanded = view.state.field(expandedBase64Field);
  const seenLineNums = new Set<number>();
  const doc = view.state.doc;

  for (const range of view.visibleRanges) {
    const startLine = doc.lineAt(range.from).number;
    const endLine = doc.lineAt(range.to).number;

    for (let lineNum = startLine; lineNum <= endLine; lineNum += 1) {
      if (seenLineNums.has(lineNum)) continue;
      seenLineNums.add(lineNum);

      const line = doc.line(lineNum);
      if (line.length < 140 || !line.text.includes('data:image/')) {
        continue;
      }

      const matches = findBase64DataUriRanges(line.text, line.from);
      for (const match of matches) {
        if (expanded.has(match.from)) {
          builder.add(
            match.to,
            match.to,
            Decoration.widget({
              widget: new Base64CollapseWidget(match.from, getLabels),
              side: 1,
            }),
          );
        } else {
          builder.add(
            match.from,
            match.to,
            Decoration.replace({
              widget: new Base64ChipWidget(match.from, match.mime, match.approxBytes, getLabels),
            }),
          );
        }
      }
    }
  }

  return builder.finish();
}

export function createBase64FoldExtension(getLabels: () => Base64FoldLabels): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildBase64Decorations(view, getLabels);
      }

      update(update: ViewUpdate) {
        const toggled = update.transactions.some((tr) =>
          tr.effects.some((ef) => ef.is(toggleBase64ExpandEffect)),
        );
        if (update.docChanged || update.viewportChanged || toggled) {
          this.decorations = buildBase64Decorations(update.view, getLabels);
        }
      }
    },
    {
      decorations: (instance) => instance.decorations,
    },
  );

  return [expandedBase64Field, plugin];
}
