const MENU_SIDEPANEL = 'prismamd-open-sidepanel';
const MENU_SEND_SELECTION = 'prismamd-send-selection';

async function openOrFocusEditorTab(query = ''): Promise<void> {
  const baseUrl = chrome.runtime.getURL('index.html');
  const existingTabs = await chrome.tabs.query({ url: `${baseUrl}*` });
  const nonSidepanel = existingTabs.find((tab) => !(tab.url ?? '').includes('mode=sidepanel'));

  if (nonSidepanel && nonSidepanel.id !== undefined) {
    await chrome.tabs.update(nonSidepanel.id, { active: true });
    if (nonSidepanel.windowId !== undefined) {
      await chrome.windows.update(nonSidepanel.windowId, { focused: true });
    }
    return;
  }

  await chrome.tabs.create({ url: `${baseUrl}${query}` });
}

chrome.action.onClicked.addListener(() => {
  void openOrFocusEditorTab();
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_SIDEPANEL,
      title: 'Abrir PrismaMD en panel lateral',
      contexts: ['page', 'selection'],
    });
    chrome.contextMenus.create({
      id: MENU_SEND_SELECTION,
      title: 'Enviar selección a Nota rápida (PrismaMD)',
      contexts: ['selection'],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_SIDEPANEL) {
    if (tab?.windowId !== undefined && chrome.sidePanel?.open) {
      void chrome.sidePanel.open({ windowId: tab.windowId });
    } else {
      void openOrFocusEditorTab('?mode=sidepanel');
    }
    return;
  }

  if (info.menuItemId === MENU_SEND_SELECTION && info.selectionText) {
    void chrome.storage.local.set({ prismamd_scratchpad_append: info.selectionText }).then(() => {
      if (tab?.windowId !== undefined && chrome.sidePanel?.open) {
        return chrome.sidePanel.open({ windowId: tab.windowId });
      }
      return openOrFocusEditorTab();
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'OPEN_MD_IN_EDITOR' && typeof message.content === 'string') {
    void chrome.storage.local
      .set({
        prismamd_incoming_md: {
          filename: String(message.filename || 'documento.md'),
          content: message.content,
          sourceUrl: String(message.sourceUrl || ''),
        },
      })
      .then(() => openOrFocusEditorTab('?from=viewer'))
      .then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
