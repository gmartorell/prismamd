import { useEffect, useState } from 'preact/hooks';
import { getDictionary } from '../../i18n';
import type { TranslationDictionary } from '../../i18n/types';
import type { ThemeMode } from '../../renderers/mermaidRenderer';

interface NodeUiState {
  theme: ThemeMode;
  t: TranslationDictionary;
}

let currentState: NodeUiState = {
  theme: 'light',
  t: getDictionary('es'),
};

const listeners = new Set<(state: NodeUiState) => void>();

export function updateNodeUiContext(theme: ThemeMode, t: TranslationDictionary): void {
  if (currentState.theme === theme && currentState.t === t) return;
  currentState = { theme, t };
  for (const listener of listeners) {
    listener(currentState);
  }
}

export function getNodeUiContext(): NodeUiState {
  return currentState;
}

export function subscribeNodeUiContext(listener: (state: NodeUiState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNodeUiContext(): NodeUiState {
  const [state, setState] = useState<NodeUiState>(currentState);
  useEffect(() => {
    setState(currentState);
    return subscribeNodeUiContext(setState);
  }, []);
  return state;
}
