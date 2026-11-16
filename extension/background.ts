const MENU_SIDEPANEL = 'prismamd-open-sidepanel';
const MENU_SEND_SELECTION = 'prismamd-send-selection';
const SCRATCHPAD_APPEND_KEY = 'prismamd_scratchpad_append';
const VIEWER_INCOMING_KEY = 'prismamd_incoming_md';

function isEnglishUi(): boolean {
  try {
    const lang = chrome.i18n?.getUILanguage?.() || navigator.language || 'es';
    return lang.toLowerCase().startsWith('en');
  } catch {
    return false;
  }
}

async function openOrFocusEditorTab(query = ''): Promise<void> {
  const baseUrl = chrome.runtime.getURL('index.html');
  const existingTabs = await chrome.tabs.query({ url: `${baseUrl}*` });
  const wantsSidepanelFallback = query.includes('mode=sidepanel');

  const matchingTab = wantsSidepanelFallback
    ? existingTabs.find((tab) => (tab.url ?? '').includes('mode=sidepanel'))
    : existingTabs.find((tab) => !(tab.url ?? '').includes('mode=sidepanel'));

  if (matchingTab && matchingTab.id !== undefined) {
    await chrome.tabs.update(matchingTab.id, { active: true });
    if (matchingTab.windowId !== undefined) {
      await chrome.windows.update(matchingTab.windowId, { focused: true });
    }
    return;
  }

  await chrome.tabs.create({ url: `${baseUrl}${query}` });
}

function openSidePanelSynchronously(tab?: chrome.tabs.Tab, fallbackQuery = '?mode=sidepanel'): void {
  if (chrome.sidePanel?.open && tab?.id !== undefined) {
    chrome.sidePanel.open({ tabId: tab.id }).catch(() => {
      openOrFocusEditorTab(fallbackQuery).catch(() => undefined);
    });
    return;
  }
  if (chrome.sidePanel?.open && tab?.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {
      openOrFocusEditorTab(fallbackQuery).catch(() => undefined);
    });
    return;
  }
  openOrFocusEditorTab(fallbackQuery).catch(() => undefined);
}

chrome.action.onClicked.addListener(() => {
  openOrFocusEditorTab().catch(() => undefined);
});

chrome.runtime.onInstalled.addListener(() => {
  const isEn = isEnglishUi();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_SIDEPANEL,
      title: isEn ? 'Open PrismaMD in Side Panel' : 'Abrir PrismaMD en panel lateral',
      contexts: ['page', 'selection'],
    });
    chrome.contextMenus.create({
      id: MENU_SEND_SELECTION,
      title: isEn
        ? 'Send selection to Quick Note (PrismaMD)'
        : 'Enviar selección a Nota rápida (PrismaMD)',
      contexts: ['selection'],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_SIDEPANEL) {
    openSidePanelSynchronously(tab, '?mode=sidepanel');
    return;
  }

  if (info.menuItemId === MENU_SEND_SELECTION && info.selectionText) {
    // Must invoke chrome.sidePanel.open synchronously inside onClicked before any async storage call
    openSidePanelSynchronously(tab, '');

    const selected = info.selectionText;
    chrome.storage.local
      .get(SCRATCHPAD_APPEND_KEY)
      .then((existingData) => {
        const prev = existingData[SCRATCHPAD_APPEND_KEY];
        const combined =
          typeof prev === 'string' && prev.trim().length > 0
            ? `${prev}\n\n${selected}`
            : selected;
        return chrome.storage.local.set({ [SCRATCHPAD_APPEND_KEY]: combined });
      })
      .catch(() => {
        chrome.storage.local.set({ [SCRATCHPAD_APPEND_KEY]: selected }).catch(() => undefined);
      });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'OPEN_MD_IN_EDITOR' && typeof message.content === 'string') {
    const defaultName = isEnglishUi() ? 'document.md' : 'documento.md';
    chrome.storage.local
      .set({
        [VIEWER_INCOMING_KEY]: {
          filename: String(message.filename || defaultName),
          content: message.content,
          sourceUrl: String(message.sourceUrl || ''),
          targetSurface: 'tab',
        },
      })
      .then(() => openOrFocusEditorTab('?from=viewer'))
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      });
    return true;
  }
  return false;
});
