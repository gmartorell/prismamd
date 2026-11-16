import type { TranslationDictionary } from '../types';

export const esDict: TranslationDictionary = {
  appName: 'PrismaMD',
  views: {
    raw: 'Raw (Markdown)',
    split: 'Dividida',
    preview: 'Vista Previa',
    rawShort: 'Raw',
    splitShort: 'Dividida',
    previewShort: 'Previa',
    viewModeAria: 'Modo de vista',
    splitResizeAria: 'Redimensionar paneles (doble clic para restablecer)',
  },
  files: {
    newNote: 'Nueva nota',
    openFile: 'Abrir archivo',
    openFolder: 'Abrir carpeta',
    save: 'Guardar',
    saveAs: 'Guardar como…',
    scratchpad: 'Nota rápida',
    untitled: 'Sin título.md',
    closeTab: 'Cerrar pestaña',
    unsavedDot: 'Cambios sin guardar',
    confirmCloseUnsaved: '¿Cerrar "{name}" sin guardar los cambios pendientes?',
    reconnectFolder: 'Carpeta desconectada tras recargar',
    reconnectFolderAction: 'Reconectar permisos',
    noFolderOpen: 'Sin carpeta abierta',
    openFolderHint: 'Abre una carpeta local para explorar tus archivos .md al instante.',
    filterFiles: 'Filtrar archivos…',
    newFileInFolder: 'Nuevo .md aquí',
    newFilePlaceholder: 'nombre-archivo.md',
    emptyFolder: 'No hay archivos Markdown en esta carpeta.',
    emptySubfolder: 'Sin archivos .md aquí',
    loadingFolder: 'Cargando carpeta…',
    readOnlyFolder: 'Sólo lectura',
    refreshFolder: 'Actualizar carpeta',
    closeFolder: 'Cerrar carpeta',
    importedFromViewer: 'Abierto desde el visor del navegador',
    savedToast: 'Guardado en disco: {name}',
    saveErrorToast: 'No se pudo guardar el archivo.',
    openErrorToast: 'No se pudo abrir el archivo.',
    folderErrorToast: 'No se pudo leer la carpeta seleccionada.',
    fileAlreadyExists: 'Ya existe un archivo llamado {name} en esta carpeta',
    invalidFileName: 'Nombre de archivo no válido',
    readOnlyBadge: 'SL',
    readOnlyFallbackSaveAs: 'Archivo de solo lectura: guardando una copia nueva',
    reloadedExternalToast: 'Recargado desde disco: {name}',
    diskConflictTitle: 'El archivo cambió fuera de PrismaMD',
    diskConflictDesc: '«{name}» fue modificado externamente y tienes cambios locales sin guardar.',
    reloadFromDisk: 'Recargar desde disco',
    overwriteDisk: 'Sobrescribir disco',
    saveAsCopy: 'Guardar como copia…',
    defaultDocFilename: 'documento',
    defaultQuickNoteFilename: 'nota-rapida.md',
    defaultNewNoteName: 'nueva-nota.md',
    imageLoadErrorToast: 'No se pudo procesar la imagen',
  },
  sidebars: {
    explorer: 'Archivos',
    outline: 'Índice',
    noHeadings: 'Añade encabezados (#) para ver el índice del documento.',
    toggleExplorer: 'Mostrar/ocultar explorador de archivos',
    toggleOutline: 'Mostrar/ocultar índice de encabezados',
    expandToTab: 'Abrir en pestaña completa',
  },
  toolbar: {
    bold: 'Negrita (Ctrl+B)',
    italic: 'Cursiva (Ctrl+I)',
    strike: 'Tachado',
    inlineCode: 'Código en línea',
    link: 'Enlace (Ctrl+K)',
    linkPrompt: 'URL del enlace:',
    heading1: 'Título 1',
    heading2: 'Título 2',
    heading3: 'Título 3',
    bulletList: 'Lista con viñetas',
    orderedList: 'Lista numerada',
    taskList: 'Lista de tareas',
    quote: 'Cita',
    codeBlock: 'Bloque de código',
    table: 'Insertar tabla 3×3',
    mermaid: 'Diagrama Mermaid',
    mathInline: 'Fórmula en línea ($…$)',
    mathBlock: 'Bloque matemático ($$…$$)',
    alert: 'Alerta GitHub',
    horizontalRule: 'Separador horizontal',
    insertImage: 'Insertar imagen (Base64)',
    search: 'Buscar y reemplazar (Ctrl+F)',
    zenMode: 'Modo Zen (Alt+Z)',
    exitZen: 'Salir de Modo Zen',
    commandPalette: 'Paleta de comandos (Ctrl+Shift+P)',
    formatHint: 'Escribe / para insertar bloques',
    installApp: 'Instalar app',
    linkInputPlaceholder: 'https://...',
    confirmOk: 'Aceptar',
    defaultLinkText: 'enlace',
    defaultImageAlt: 'imagen',
  },
  slash: {
    title: 'Insertar bloque',
    empty: 'Sin coincidencias',
    items: {
      h1: { title: 'Encabezado 1', desc: 'Sección principal grande' },
      h2: { title: 'Encabezado 2', desc: 'Subsección de nivel medio' },
      h3: { title: 'Encabezado 3', desc: 'Apartado de tercer nivel' },
      bulletList: { title: 'Lista con viñetas', desc: 'Lista simple sin orden' },
      orderedList: { title: 'Lista numerada', desc: 'Pasos ordenados 1, 2, 3' },
      taskList: { title: 'Lista de tareas', desc: 'Casillas interactivas [x]' },
      table: { title: 'Tabla GFM', desc: 'Tabla editable 3×3 con cabecera' },
      codeBlock: { title: 'Bloque de código', desc: 'Código con resaltado de sintaxis' },
      mermaid: { title: 'Diagrama Mermaid', desc: 'Flujograma, secuencia o Gantt en vivo' },
      mathBlock: { title: 'Fórmula en bloque', desc: 'Ecuación LaTeX centrada ($$)' },
      mathInline: { title: 'Fórmula en línea', desc: 'Expresión LaTeX dentro del texto ($)' },
      alertNote: { title: 'Alerta Nota', desc: 'Bloque destacado [!NOTE]' },
      alertWarning: { title: 'Alerta Aviso', desc: 'Bloque destacado [!WARNING]' },
      quote: { title: 'Cita', desc: 'Bloque de texto citado' },
      divider: { title: 'Línea divisoria', desc: 'Separador horizontal (---)' },
      image: { title: 'Imagen Base64', desc: 'Incrustar imagen desde el disco' },
    },
  },
  table: {
    addRowAbove: 'Fila arriba',
    addRowBelow: 'Fila abajo',
    deleteRow: 'Borrar fila',
    addColLeft: 'Columna izq.',
    addColRight: 'Columna der.',
    deleteCol: 'Borrar col.',
    alignLeft: 'Alinear izq.',
    alignCenter: 'Centrar',
    alignRight: 'Alinear der.',
    deleteTable: 'Eliminar tabla',
  },
  blocks: {
    frontmatterTitle: 'Frontmatter YAML',
    frontmatterPlaceholder: 'title: Mi documento\ntags: [markdown, notas]',
    mermaidTitle: 'Diagrama Mermaid',
    editCode: 'Editar código',
    preview: 'Solo vista',
    mermaidError: 'Error de sintaxis Mermaid',
    mermaidEmpty: 'Escribe código Mermaid para previsualizar el diagrama.',
    mathInlineTitle: 'Fórmula LaTeX',
    mathBlockTitle: 'Bloque LaTeX',
    latexPlaceholder: 'E = mc^2',
    apply: 'Aplicar',
    cancel: 'Cancelar',
    rawHtmlTitle: 'HTML directo',
    placeholderEditor: 'Empieza a escribir o pulsa / para insertar bloques…',
    codeLanguageAuto: 'Texto plano',
    codeLanguageAria: 'Lenguaje del bloque de código',
    copyCode: 'Copiar',
    codeCopied: 'Copiado',
    alerts: {
      NOTE: 'Nota',
      TIP: 'Consejo',
      IMPORTANT: 'Importante',
      WARNING: 'Advertencia',
      CAUTION: 'Precaución',
    },
  },
  base64: {
    expand: 'expandir',
    collapse: 'plegar base64',
    imageLabel: 'imagen',
  },
  themes: {
    label: 'Tema',
    light: 'Claro',
    dark: 'Oscuro',
    sepia: 'Sepia',
  },
  language: {
    label: 'Idioma',
  },
  exportMenu: {
    label: 'Exportar',
    exportHtml: 'Exportar HTML autocontenido',
    exportPdf: 'Exportar / Imprimir PDF',
    copyRichText: 'Copiar texto enriquecido',
    copiedRichText: 'Copiado como texto enriquecido al portapapeles',
    exportedHtml: 'HTML exportado correctamente',
    copyError: 'No se pudo copiar al portapapeles',
  },
  palette: {
    placeholder: 'Escribe un comando o busca una acción…',
    noResults: 'No se encontraron comandos',
    categories: {
      view: 'Vista',
      file: 'Archivo',
      format: 'Formato',
      theme: 'Apariencia',
      export: 'Exportar',
      language: 'Idioma',
    },
  },
  status: {
    words: 'palabras',
    chars: 'caracteres',
    minRead: 'min lectura',
    lineCol: 'Lín {line}, Col {col}',
    saved: 'Guardado',
    modified: 'Modificado',
    draft: 'Borrador local',
    scrollSyncOn: 'Scroll sincronizado',
    scrollSyncOff: 'Scroll libre',
  },
  about: {
    versionLabel: 'Versión',
    menuCommand: 'Versión y buscar actualizaciones',
    title: 'Versión y actualizaciones',
    currentVersion: 'Versión instalada',
    latestVersion: 'Última versión disponible',
    channelLabel: 'Entorno',
    channelPwa: 'PWA instalable (100 % offline)',
    channelExtension: 'Extensión Chromium MV3',
    checkUpdates: 'Buscar actualizaciones',
    checkingUpdates: 'Comprobando actualizaciones…',
    upToDate: 'Estás en la última versión.',
    updateAvailable: 'Nueva versión {version} disponible.',
    updateAvailableShort: 'Nueva',
    applyUpdate: 'Actualizar ahora',
    offlineStatus: 'Sin conexión: no se pudo consultar el servidor.',
    managedByStore: 'Chrome gestiona las actualizaciones de esta extensión.',
    close: 'Cerrar',
  },
  demoMarkdown: `---
title: Bienvenido a PrismaMD
author: Tu espacio Markdown
---

# PrismaMD: Rápido, Raw y Vista Previa

Edita **directamente en cualquiera de las dos vistas**: todo lo que escribas en **Raw** o en la **Vista Previa** se sincroniza al instante manteniendo tu archivo limpio y autocontenido.

> [!TIP]
> Pega o arrastra cualquier imagen (\`Ctrl+V\`), prueba a escribir \`/\` en una línea vacía de la Vista Previa para insertar bloques, o cambia entre **Raw** (\`Ctrl+1\`), **Dividida** (\`Ctrl+2\`) y **Vista Previa** (\`Ctrl+3\`).

## Lista de tareas y tablas editables

- [x] Edición bidireccional instantánea **Raw ↔ Vista Previa**
- [x] Imágenes incrustadas en Base64 con plegado inteligente en Raw
- [ ] Abre una carpeta local o pulsa \`Ctrl+S\` para guardar en disco

| Función | Atajo / Comando | Estado |
| :--- | :---: | ---: |
| Cambiar de vista | \`Ctrl+1 / 2 / 3\` | Listo |
| Paleta de comandos | \`Ctrl+Shift+P\` | Activo |
| Modo Zen sin distracciones | \`Alt+Z\` | Activo |

## Diagramas Mermaid en vivo

\`\`\`mermaid
flowchart LR
  A[Archivo .md en disco] --> B{PrismaMD}
  B -->|Raw| C[CodeMirror 6 + Plegado Base64]
  B -->|Previa| D[WYSIWYG + Tablas + /comandos]
\`\`\`

## Fórmulas matemáticas LaTeX

La identidad de Euler $e^{i\\pi} + 1 = 0$ funciona en línea, y también en bloque:

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$
`,
};
