import type { TranslationDictionary } from '../types';

export const enDict: TranslationDictionary = {
  appName: 'PrismaMD',
  views: {
    raw: 'Raw (Markdown)',
    split: 'Split View',
    preview: 'Preview',
    rawShort: 'Raw',
    splitShort: 'Split',
    previewShort: 'Preview',
    viewModeAria: 'View mode',
    splitResizeAria: 'Resize split panes (double-click to reset)',
  },
  files: {
    newNote: 'New note',
    openFile: 'Open file',
    openFolder: 'Open folder',
    save: 'Save',
    saveAs: 'Save as…',
    scratchpad: 'Quick Note',
    untitled: 'Untitled.md',
    closeTab: 'Close tab',
    unsavedDot: 'Unsaved changes',
    confirmCloseUnsaved: 'Close "{name}" without saving pending changes?',
    reconnectFolder: 'Folder disconnected after reload',
    reconnectFolderAction: 'Restore permission',
    noFolderOpen: 'No folder open',
    openFolderHint: 'Open a local folder to browse and edit your .md files instantly.',
    filterFiles: 'Filter files…',
    newFileInFolder: 'New .md here',
    newFilePlaceholder: 'note-name.md',
    emptyFolder: 'No Markdown files found in this folder.',
    emptySubfolder: 'No .md files here',
    loadingFolder: 'Loading folder…',
    readOnlyFolder: 'Read-only',
    refreshFolder: 'Refresh folder',
    closeFolder: 'Close folder',
    importedFromViewer: 'Opened from browser viewer',
    savedToast: 'Saved to disk: {name}',
    saveErrorToast: 'Could not save the file.',
    openErrorToast: 'Could not open the file.',
    folderErrorToast: 'Could not read the selected folder.',
    fileAlreadyExists: 'A file named {name} already exists in this folder',
    invalidFileName: 'Invalid file name',
    readOnlyBadge: 'RO',
    readOnlyFallbackSaveAs: 'Read-only file: saving as a new copy',
    reloadedExternalToast: 'Reloaded from disk: {name}',
    diskConflictTitle: 'File changed on disk',
    diskConflictDesc: '"{name}" was modified externally while you have unsaved local changes.',
    reloadFromDisk: 'Reload from disk',
    overwriteDisk: 'Overwrite disk',
    saveAsCopy: 'Save as copy…',
    defaultDocFilename: 'document',
    defaultQuickNoteFilename: 'quick-note.md',
    defaultNewNoteName: 'new-note.md',
    imageLoadErrorToast: 'Could not process image',
  },
  sidebars: {
    explorer: 'Files',
    outline: 'Outline',
    noHeadings: 'Add headings (#) to see the document outline.',
    toggleExplorer: 'Toggle file explorer',
    toggleOutline: 'Toggle document outline',
    expandToTab: 'Open in full tab',
  },
  toolbar: {
    bold: 'Bold (Ctrl+B)',
    italic: 'Italic (Ctrl+I)',
    strike: 'Strikethrough',
    inlineCode: 'Inline code',
    link: 'Link (Ctrl+K)',
    linkPrompt: 'Link URL:',
    heading1: 'Heading 1',
    heading2: 'Heading 2',
    heading3: 'Heading 3',
    bulletList: 'Bullet list',
    orderedList: 'Ordered list',
    taskList: 'Task list',
    quote: 'Quote',
    codeBlock: 'Code block',
    table: 'Insert 3×3 table',
    mermaid: 'Mermaid diagram',
    mathInline: 'Inline math ($…$)',
    mathBlock: 'Math block ($$…$$)',
    alert: 'GitHub Alert',
    horizontalRule: 'Horizontal divider',
    insertImage: 'Insert image (Base64)',
    search: 'Find & Replace (Ctrl+F)',
    zenMode: 'Zen Mode (Alt+Z)',
    exitZen: 'Exit Zen Mode',
    commandPalette: 'Command Palette (Ctrl+Shift+P)',
    formatHint: 'Type / to insert blocks',
    installApp: 'Install app',
    linkInputPlaceholder: 'https://...',
    confirmOk: 'OK',
    defaultLinkText: 'link',
    defaultImageAlt: 'image',
  },
  slash: {
    title: 'Insert block',
    empty: 'No matching blocks',
    items: {
      h1: { title: 'Heading 1', desc: 'Large top-level section' },
      h2: { title: 'Heading 2', desc: 'Medium subsection heading' },
      h3: { title: 'Heading 3', desc: 'Third-level subsection' },
      bulletList: { title: 'Bullet List', desc: 'Simple unordered list' },
      orderedList: { title: 'Numbered List', desc: 'Ordered steps 1, 2, 3' },
      taskList: { title: 'Task Checklist', desc: 'Interactive checkboxes [x]' },
      table: { title: 'GFM Table', desc: 'Editable 3×3 table with header' },
      codeBlock: { title: 'Code Block', desc: 'Syntax-highlighted source code' },
      mermaid: { title: 'Mermaid Diagram', desc: 'Live flowchart, sequence or Gantt' },
      mathBlock: { title: 'Math Block', desc: 'Centered LaTeX equation ($$)' },
      mathInline: { title: 'Inline Math', desc: 'Inline LaTeX expression ($)' },
      alertNote: { title: 'Note Alert', desc: 'GitHub callout [!NOTE]' },
      alertWarning: { title: 'Warning Alert', desc: 'GitHub callout [!WARNING]' },
      quote: { title: 'Blockquote', desc: 'Quoted text block' },
      divider: { title: 'Divider', desc: 'Horizontal rule (---)' },
      image: { title: 'Base64 Image', desc: 'Embed local image as Data URI' },
    },
  },
  table: {
    addRowAbove: 'Row above',
    addRowBelow: 'Row below',
    deleteRow: 'Delete row',
    addColLeft: 'Col left',
    addColRight: 'Col right',
    deleteCol: 'Delete col',
    alignLeft: 'Align left',
    alignCenter: 'Center',
    alignRight: 'Align right',
    deleteTable: 'Delete table',
  },
  blocks: {
    frontmatterTitle: 'YAML Frontmatter',
    frontmatterPlaceholder: 'title: My document\ntags: [markdown, notes]',
    mermaidTitle: 'Mermaid Diagram',
    editCode: 'Edit code',
    preview: 'Preview only',
    mermaidError: 'Mermaid syntax error',
    mermaidEmpty: 'Write Mermaid code to preview the diagram.',
    mathInlineTitle: 'LaTeX Formula',
    mathBlockTitle: 'LaTeX Block',
    latexPlaceholder: 'E = mc^2',
    apply: 'Apply',
    cancel: 'Cancel',
    rawHtmlTitle: 'Raw HTML',
    placeholderEditor: 'Start writing or type / to insert blocks…',
    codeLanguageAuto: 'Plain text',
    codeLanguageAria: 'Code block language',
    copyCode: 'Copy',
    codeCopied: 'Copied',
    alerts: {
      NOTE: 'Note',
      TIP: 'Tip',
      IMPORTANT: 'Important',
      WARNING: 'Warning',
      CAUTION: 'Caution',
    },
  },
  base64: {
    expand: 'expand',
    collapse: 'fold base64',
    imageLabel: 'image',
  },
  themes: {
    label: 'Theme',
    light: 'Light',
    dark: 'Dark',
    sepia: 'Sepia',
  },
  language: {
    label: 'Language',
  },
  exportMenu: {
    label: 'Export',
    exportHtml: 'Export standalone HTML',
    exportPdf: 'Export / Print PDF',
    copyRichText: 'Copy as rich text',
    copiedRichText: 'Copied rich text to clipboard',
    exportedHtml: 'Exported standalone HTML',
    copyError: 'Could not copy to clipboard',
  },
  palette: {
    placeholder: 'Type a command or search actions…',
    noResults: 'No matching commands',
    categories: {
      view: 'View',
      file: 'File',
      format: 'Format',
      theme: 'Appearance',
      export: 'Export',
      language: 'Language',
    },
  },
  status: {
    words: 'words',
    chars: 'chars',
    minRead: 'min read',
    lineCol: 'Ln {line}, Col {col}',
    saved: 'Saved',
    modified: 'Modified',
    draft: 'Local draft',
    scrollSyncOn: 'Scroll sync',
    scrollSyncOff: 'Free scroll',
  },
  about: {
    versionLabel: 'Version',
    openAbout: 'About PrismaMD',
    menuCommand: 'About PrismaMD (version, license & updates)',
    title: 'About PrismaMD',
    description:
      'Fast, 100% local (Zero-CDN) bidirectional Markdown editor with Raw and WYSIWYG Preview modes.',
    copyrightLabel: 'Copyright',
    copyrightValue: '© 2026 Guillem Martorell Nicolau',
    licenseLabel: 'License',
    licenseValue: 'MIT (Open Source)',
    licenseNote: 'Free to use, copy, and fork while keeping the copyright notice and attributing the author.',
    repositoryLabel: 'Repository',
    viewOnGithub: 'View on GitHub',
    currentVersion: 'Installed version',
    latestVersion: 'Latest available version',
    channelLabel: 'Runtime',
    channelPwa: 'Installable PWA (100% offline)',
    channelExtension: 'Chromium MV3 Extension',
    checkUpdates: 'Check for updates',
    checkingUpdates: 'Checking for updates…',
    upToDate: 'You are on the latest version.',
    updateAvailable: 'New version {version} is available.',
    updateAvailableShort: 'Update',
    applyUpdate: 'Update now',
    offlineStatus: 'Offline: could not reach the server.',
    managedByStore: 'Chrome manages updates for this extension automatically.',
    close: 'Close',
  },
  demoMarkdown: `---
title: Welcome to PrismaMD
author: Your Markdown Workspace
---

# PrismaMD: Fast, Raw & Preview

Edit **directly in either pane**: everything you type in **Raw** or **Preview** syncs immediately while keeping your Markdown clean and self-contained.

> [!TIP]
> Paste or drop any image (\`Ctrl+V\`), type \`/\` on an empty line in Preview to insert blocks, or switch instantly between **Raw** (\`Ctrl+1\`), **Split** (\`Ctrl+2\`), and **Preview** (\`Ctrl+3\`).

## Interactive Checklists & Tables

- [x] Instant bidirectional **Raw ↔ Preview** editing
- [x] Self-contained Base64 images with smart folding in Raw
- [ ] Open a local folder or press \`Ctrl+S\` to save directly to disk

| Feature | Shortcut / Command | Status |
| :--- | :---: | ---: |
| Switch view mode | \`Ctrl+1 / 2 / 3\` | Ready |
| Command palette | \`Ctrl+Shift+P\` | Active |
| Distraction-free Zen | \`Alt+Z\` | Active |

## Live Mermaid Diagrams

\`\`\`mermaid
flowchart LR
  A[.md file on disk] --> B{PrismaMD}
  B -->|Raw| C[CodeMirror 6 + Base64 Folding]
  B -->|Preview| D[WYSIWYG + Tables + /commands]
\`\`\`

## LaTeX Math Equations

Euler's identity $e^{i\\pi} + 1 = 0$ renders inline, as well as display blocks:

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$
`,
};
