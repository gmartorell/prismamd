import {
  EditorState,
  Facet,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type ChangeSpec,
  type Extension,
  type Text,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view';
import { formatByteSize } from '../../markdown/imageDataUri';

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

type LabelsProvider = Base64FoldLabels | (() => Base64FoldLabels);

const DEFAULT_LABELS: Base64FoldLabels = {
  expand: 'Expand',
  collapse: 'Collapse',
  imageLabel: 'Base64 image',
};

// Strictly single-line match: `[A-Za-z0-9+/=]` never matches `\r` or `\n` (AGENTS.md §3.3)
const DATA_URI_LINE_REGEX = /data:image\/([a-zA-Z0-9.+-]+);base64,[A-Za-z0-9+/=]{120,}/g;
const DATA_IMAGE_PREFIX_LEN = 'data:image/'.length;
const BASE64_MARKER_LEN = ';base64,'.length;

export function findBase64DataUriRanges(lineText: string, lineFrom: number): Base64UriMatch[] {
  const matches: Base64UriMatch[] = [];
  DATA_URI_LINE_REGEX.lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = DATA_URI_LINE_REGEX.exec(lineText)) !== null) {
    const rawMime = m[1];
    const fullLen = m[0].length;
    const matchStartInLine = m.index;
    const matchEndInLine = matchStartInLine + fullLen;
    const payloadLen = fullLen - (DATA_IMAGE_PREFIX_LEN + rawMime.length + BASE64_MARKER_LEN);

    let padding = 0;
    if (lineText.charCodeAt(matchEndInLine - 1) === 61 /* '=' */) {
      padding = lineText.charCodeAt(matchEndInLine - 2) === 61 ? 2 : 1;
    }
    const approxBytes = Math.max(0, Math.floor((payloadLen * 3) / 4) - padding);

    const from = lineFrom + matchStartInLine;
    const to = from + fullLen;
    matches.push({
      from,
      to,
      mime: rawMime.toLowerCase(),
      approxBytes,
    });
  }

  return matches;
}

function resolveLabelsValue(provider: LabelsProvider): Base64FoldLabels {
  const resolved = typeof provider === 'function' ? provider() : provider;
  return {
    expand: resolved.expand,
    collapse: resolved.collapse,
    imageLabel: resolved.imageLabel,
  };
}

function labelsEqual(a: Base64FoldLabels, b: Base64FoldLabels): boolean {
  return a.expand === b.expand && a.collapse === b.collapse && a.imageLabel === b.imageLabel;
}

const base64LabelsFacet = Facet.define<LabelsProvider, Base64FoldLabels>({
  combine(providers) {
    if (providers.length === 0) return DEFAULT_LABELS;
    return resolveLabelsValue(providers[providers.length - 1]);
  },
});

export function createBase64LabelsExtension(labels: LabelsProvider): Extension {
  return base64LabelsFacet.of(labels);
}

export const toggleBase64ExpandEffect = StateEffect.define<number>();

class Base64ChipWidget extends WidgetType {
  constructor(
    private readonly from: number,
    private readonly mime: string,
    private readonly approxBytes: number,
    private readonly labels: Base64FoldLabels,
  ) {
    super();
  }

  eq(other: Base64ChipWidget): boolean {
    return (
      other.from === this.from &&
      other.mime === this.mime &&
      other.approxBytes === this.approxBytes &&
      labelsEqual(other.labels, this.labels)
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cm-base64-chip';
    btn.setAttribute(
      'aria-label',
      `${this.labels.imageLabel} ${this.mime} ${formatByteSize(this.approxBytes)}`,
    );

    const icon = document.createElement('span');
    icon.className = 'cm-base64-chip-badge';
    icon.textContent = `base64/${this.mime}`;

    const size = document.createElement('span');
    size.className = 'cm-base64-chip-size';
    size.textContent = formatByteSize(this.approxBytes);

    const action = document.createElement('span');
    action.className = 'cm-base64-chip-action';
    action.textContent = `[${this.labels.expand}]`;

    btn.append(icon, size, action);
    btn.addEventListener('mousedown', (e) => {
      // Preserve editor cursor on pointer press while allowing click + keyboard Enter/Space
      e.preventDefault();
    });
    btn.addEventListener('click', (e) => {
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
    private readonly collapseLabel: string,
  ) {
    super();
  }

  eq(other: Base64CollapseWidget): boolean {
    return other.from === this.from && other.collapseLabel === this.collapseLabel;
  }

  toDOM(view: EditorView): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cm-base64-chip cm-base64-chip-collapse';
    btn.textContent = `[${this.collapseLabel}]`;
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });
    btn.addEventListener('click', (e) => {
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

export interface Base64FoldState {
  matches: Base64UriMatch[];
  expanded: Set<number>;
  labels: Base64FoldLabels;
  decorations: DecorationSet;
}

function scanDocLines(doc: Text, startLine: number, endLine: number): Base64UriMatch[] {
  const found: Base64UriMatch[] = [];
  const clampedStart = Math.max(1, startLine);
  const clampedEnd = Math.min(doc.lines, endLine);

  for (let lineNum = clampedStart; lineNum <= clampedEnd; lineNum += 1) {
    const line = doc.line(lineNum);
    if (line.length < 140 || !line.text.includes('data:image/')) {
      continue;
    }
    const lineMatches = findBase64DataUriRanges(line.text, line.from);
    for (const match of lineMatches) {
      // Enforce AGENTS.md §3.3 invariant: never cross line boundaries
      if (match.from >= line.from && match.to <= line.to && match.from < match.to) {
        found.push(match);
      }
    }
  }

  return found;
}

function buildDecorationsFromMatches(
  matches: Base64UriMatch[],
  expanded: Set<number>,
  labels: Base64FoldLabels,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const match of matches) {
    if (expanded.has(match.from)) {
      builder.add(
        match.to,
        match.to,
        Decoration.widget({
          widget: new Base64CollapseWidget(match.from, labels.collapse),
          side: 1,
        }),
      );
    } else {
      builder.add(
        match.from,
        match.to,
        Decoration.replace({
          widget: new Base64ChipWidget(match.from, match.mime, match.approxBytes, labels),
        }),
      );
    }
  }
  return builder.finish();
}

function mergeNumericIntervals(intervals: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  if (intervals.length <= 1) return intervals;
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Array<{ start: number; end: number }> = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = merged[merged.length - 1];
    const curr = sorted[i];
    if (curr.start <= prev.end + 1) {
      prev.end = Math.max(prev.end, curr.end);
    } else {
      merged.push({ ...curr });
    }
  }
  return merged;
}

function mergePosIntervals(intervals: Array<{ from: number; to: number }>): Array<{ from: number; to: number }> {
  if (intervals.length <= 1) return intervals;
  const sorted = [...intervals].sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: Array<{ from: number; to: number }> = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = merged[merged.length - 1];
    const curr = sorted[i];
    if (curr.from <= prev.to) {
      prev.to = Math.max(prev.to, curr.to);
    } else {
      merged.push({ ...curr });
    }
  }
  return merged;
}

export const base64FoldStateField = StateField.define<Base64FoldState>({
  create(state) {
    const labels = state.facet(base64LabelsFacet);
    const matches = scanDocLines(state.doc, 1, state.doc.lines);
    const expanded = new Set<number>();
    return {
      matches,
      expanded,
      labels,
      decorations: buildDecorationsFromMatches(matches, expanded, labels),
    };
  },

  update(prev, tr) {
    const nextLabels = tr.state.facet(base64LabelsFacet);
    let matches = prev.matches;
    let expanded = prev.expanded;
    let changed = !labelsEqual(prev.labels, nextLabels);

    if (tr.docChanged) {
      changed = true;
      const oldDirtyRaw: Array<{ from: number; to: number }> = [];
      const newDirtyLinesRaw: Array<{ start: number; end: number }> = [];

      tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
        const oldStartLine = tr.startState.doc.lineAt(fromA);
        const oldEndLine = tr.startState.doc.lineAt(toA);
        oldDirtyRaw.push({ from: oldStartLine.from, to: oldEndLine.to });

        const newStartLine = tr.newDoc.lineAt(fromB).number;
        const newEndLine = tr.newDoc.lineAt(toB).number;
        newDirtyLinesRaw.push({ start: newStartLine, end: newEndLine });
      });

      const oldDirty = mergePosIntervals(oldDirtyRaw);
      const newDirtyLines = mergeNumericIntervals(newDirtyLinesRaw);

      const keptMatches: Base64UriMatch[] = [];
      for (const m of prev.matches) {
        const overlapsDirty = oldDirty.some((iv) => m.from <= iv.to && m.to >= iv.from);
        if (!overlapsDirty) {
          const nextFrom = tr.changes.mapPos(m.from, 1);
          const nextTo = nextFrom + (m.to - m.from);
          keptMatches.push({
            from: nextFrom,
            to: nextTo,
            mime: m.mime,
            approxBytes: m.approxBytes,
          });
        }
      }

      const rescannedMatches: Base64UriMatch[] = [];
      for (const seg of newDirtyLines) {
        rescannedMatches.push(...scanDocLines(tr.newDoc, seg.start, seg.end));
      }

      matches = [...keptMatches, ...rescannedMatches].sort((a, b) => a.from - b.from);

      if (prev.expanded.size > 0) {
        const validStarts = new Set(matches.map((m) => m.from));
        const mappedExpanded = new Set<number>();
        for (const pos of prev.expanded) {
          if (pos <= tr.startState.doc.length) {
            const mappedPos = tr.changes.mapPos(pos, 1);
            if (validStarts.has(mappedPos)) {
              mappedExpanded.add(mappedPos);
            }
          }
        }
        expanded = mappedExpanded;
      }
    }

    for (const effect of tr.effects) {
      if (effect.is(toggleBase64ExpandEffect)) {
        changed = true;
        const clone = new Set(expanded);
        if (clone.has(effect.value)) {
          clone.delete(effect.value);
        } else {
          clone.add(effect.value);
        }
        expanded = clone;
      }
    }

    if (!changed) {
      return prev;
    }

    return {
      matches,
      expanded,
      labels: nextLabels,
      decorations: buildDecorationsFromMatches(matches, expanded, nextLabels),
    };
  },

  provide: (field) => EditorView.decorations.from(field, (state) => state.decorations),
});

function changeModifiesInsideFoldedBase64(
  fromA: number,
  toA: number,
  foldedMatches: Base64UriMatch[],
): boolean {
  for (const m of foldedMatches) {
    if (m.from >= toA && fromA !== toA) break;
    if (fromA === toA) {
      if (fromA > m.from && fromA < m.to) return true;
    } else if (fromA < m.to && toA > m.from) {
      // Allow deleting/replacing the entire Base64 URI as a whole, block interior payload corruption
      const coversWholeUri = fromA <= m.from && toA >= m.to;
      if (!coversWholeUri) return true;
    }
  }
  return false;
}

const base64ReplaceAllGuard = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  if (tr.isUserEvent('undo') || tr.isUserEvent('redo')) return tr;

  const foldState = tr.startState.field(base64FoldStateField, false);
  if (!foldState || foldState.matches.length === 0) return tr;

  const isSearchReplace =
    tr.isUserEvent('input.replace.all') || tr.isUserEvent('input.replace');

  const rawChanges: Array<{ from: number; to: number; insert: string }> = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    rawChanges.push({ from: fromA, to: toA, insert: inserted.toString() });
  });

  if (!isSearchReplace && rawChanges.length <= 1) {
    return tr;
  }

  const foldedMatches = foldState.matches.filter((m) => !foldState.expanded.has(m.from));
  if (foldedMatches.length === 0) return tr;

  const safeChanges: ChangeSpec[] = [];
  let blockedAny = false;

  for (const ch of rawChanges) {
    if (changeModifiesInsideFoldedBase64(ch.from, ch.to, foldedMatches)) {
      blockedAny = true;
    } else {
      safeChanges.push(ch);
    }
  }

  if (!blockedAny) return tr;
  if (safeChanges.length === 0) return [];

  return {
    changes: safeChanges,
    effects: tr.effects,
  };
});

export function createBase64FoldExtension(labels: LabelsProvider): Extension {
  return [
    base64LabelsFacet.of(labels),
    base64FoldStateField,
    base64ReplaceAllGuard,
  ];
}
