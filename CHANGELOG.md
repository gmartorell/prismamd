# Changelog

Todos los cambios relevantes de **PrismaMD** se documentarán en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/), y el versionado sigue el esquema **`año.mes.dia.versiondiaria`** (por ejemplo `2026.11.15.1`, reiniciando `versiondiaria` en `1` cada nuevo día y usando enteros sin ceros a la izquierda para compatibilidad con Chromium Manifest V3).

> Para publicar automáticamente los cambios acumulados en `[Unreleased]` a una nueva versión, ejecuta `npm run release`.

## [Unreleased]

## [2026.11.16.4] - 2026-11-16

### Cambiado
- Permitido cerrar la pestaña **Nota rápida** (`Scratchpad`) mediante el botón `×`, clic central o tecla `Delete` ([TabBar.tsx](src/components/TabBar.tsx), [AppShell.tsx](src/components/AppShell.tsx)), mostrando su indicador de cambios sin guardar, abriendo una pestaña en blanco si era la última abierta, evitando reabrirla automáticamente al recargar, sustituyéndola por la pestaña del archivo al guardar con `Ctrl+S` y permitiendo reabrirla desde la Paleta de comandos o el menú contextual.

## [2026.11.16.3] - 2026-11-16

### Añadido
- Sanitizador HTML offline basado en `DOMParser` (`src/utils/htmlSanitizer.ts`) con lista blanca de etiquetas y esquemas URL seguros (`http(s):`, `mailto:`, `#`, rutas relativas y `data:image/*;base64,...`), más política CSP estricta (`default-src 'none'`) en documentos HTML exportados e impresión PDF.
- Cabecera interactiva en bloques de código de **Vista Previa** (`PreviewEditor.tsx`, `app.css`) con selector de lenguaje (`lowlight`), botón de copiado rápido y resaltado sintáctico `.hljs-*` adaptado a los temas **Claro**, **Oscuro** y **Sepia**.
- Divisor arrastrable y accesible por teclado (`.split-divider` con rango `20%–80%`, restablecimiento con doble clic y persistencia local) en modo **Pantalla Dividida**.
- Detección de conflictos externos en disco al estilo VS Code (`fileSystem.ts`, `AppShell.tsx`): recarga silenciosa si la pestaña está limpia y diálogo modal de resolución (*Recargar desde disco*, *Sobrescribir disco*, *Guardar como copia…*) cuando existen cambios locales sin guardar, además de respaldo automático a *Guardar como…* en archivos de solo lectura del sistema operativo.
- Soporte de apertura de carpetas en navegadores no Chromium (Firefox/Safari) mediante respaldo `<input webkitdirectory>` en modo solo lectura y preservación de subcarpetas expandidas al refrescar el explorador lateral.
- Sincronización en tiempo real de pestañas entre contextos abiertos (Pestaña completa ↔ Side Panel) mediante `BroadcastChannel` y aislamiento independiente de disposición visual del Side Panel.

### Cambiado
- Reasignado el atajo de teclado de **Modo Zen** de `Ctrl+Shift+Z` a **`Alt+Z`** para no colisionar con *Rehacer* (`Redo`), y añadidos atajos globales `Ctrl+P` / `Cmd+P` (exportar/imprimir PDF) y `Ctrl+F` / `Cmd+F` desde **Vista Previa**.
- Guardar la **Nota rápida** (*Scratchpad*) en disco ahora promueve el contenido a una nueva pestaña de archivo dedicada y restablece la Nota rápida limpia sin vincularla nunca a un `FileSystemFileHandle`.
- Arquitectura de caché PWA en dos niveles (`finalize-pwa.mjs`, `pwa/sw.js`, `main.tsx`, `vite.config.ts`): precarga inicial reducida exclusivamente al *app shell* esencial con `buildHash` determinista, precarga diferida en segundo plano (`WARM_LAZY_ASSETS`) de chunks perezosos de Mermaid/KaTeX divididos por motor y eliminación de fuentes `.woff`/`.ttf` redundantes.
- Refinada la accesibilidad (`role="dialog"`, navegación por teclado en `TabBar`, `CommandPalette`, `SlashCommandMenu`, chips Base64 y cierre con `Escape`), sincronización dinámica de `<html lang>` / `<meta name="theme-color">` (`App.tsx`) y cobertura completa i18n ES/EN sin cadenas fijas en código.

### Corregido
- Protección contra sobrescritura accidental al crear archivos en carpetas (`createFileInFolder` verifica `{ create: false }` y valida nombres inválidos o dotfiles), cola serializada de escrituras en IndexedDB, guardia de hidratación inicial y volcado seguro en `pagehide`/`visibilitychange`/`beforeunload`.
- Pérdida de datos y bordes en el puente AST (`bridge.ts`): preservación sin pérdidas de enlaces/imágenes por referencia (`[id]: url`), notas al pie GFM (`[^1]`), agrupación de marcas inline compartidas sin entidades `&#x20;`, metadatos de bloques de código, listas numeradas de tareas, celdas de tabla multipárrafo (`<br>`), tuberías `|` en fórmulas dentro de tablas, alineación por columna completa y guardia frente a importes monetarios (`$10 and $20`).
- Edición de fórmulas `mathInline` vacías en **Vista Previa** (`MathExtensions.tsx`, eliminando el nodo vacío en lugar de emitir `$$`), copiado `Ctrl+C` (`renderText`) en nodos técnicos, bloqueo de inyección de atributos HTML externos al pegar (`RawHtmlExtensions.tsx`), barra flotante de tablas en superposición sin salto de layout y `ignoreMutation` en alertas GitHub.
- Plegado incremental de imágenes Base64 por línea (`StateField` en `base64FoldExtension.ts`) con bloqueo frente a corrupción por *Reemplazar todo*, historial limpio en sincronizaciones externas (`Transaction.addToHistory.of(false)` en `RawEditor.tsx`), prevención de doble disparo en `Ctrl+S` / `Ctrl+Shift+S`, estilos `@media print` multipágina y permisos/gestos síncronos en la extensión MV3 (`background.ts`, `mdViewerContent.ts`).

## [2026.11.16.2] - 2026-11-16

### Corregido
- Exportación a PDF / impresión y HTML autocontenido con fórmulas KaTeX ([exporter.ts](src/utils/exporter.ts)): resueltas e incrustadas las fuentes `.woff2` de KaTeX como Data URIs (`data:font/woff2;base64,...`) con `font-display: swap` y espera explícita a `document.fonts.ready` e imágenes antes de invocar `print()`, evitando fórmulas invisibles en la PWA instalada en Linux y Windows.

## [2026.11.16.1] - 2026-11-16

### Añadido
- Licencia open source **MIT** en [LICENSE](LICENSE) (`Copyright (c) 2026 Guillem Martorell Nicolau`) junto con metadatos de autoría y repositorio en [package.json](package.json) y [README.md](README.md).
- Workflow de GitHub Actions ([deploy-pwa.yml](.github/workflows/deploy-pwa.yml)) para validar tipos, ejecutar tests y desplegar automáticamente `dist-pwa/` en GitHub Pages al hacer push a `main`.

## [2026.11.15.6] - 2026-11-15

### Añadido
- Indicador visible de versión (`v<año.mes.dia.versiondiaria>`) en [StatusBar.tsx](file:///projects/antigravity/mdeditor/src/components/StatusBar.tsx) y entrada en la Paleta de comandos para abrir el diálogo [VersionModal.tsx](file:///projects/antigravity/mdeditor/src/components/VersionModal.tsx) de versión instalada y comprobación de actualizaciones.
- Detector local de actualizaciones en [version.ts](file:///projects/antigravity/mdeditor/src/utils/version.ts) (vía Service Worker `SKIP_WAITING` + limpieza de caché obsoleta y [version.json](file:///projects/antigravity/mdeditor/scripts/finalize-pwa.mjs) en el mismo origen para PWA, o `chrome.runtime.requestUpdateCheck` en la extensión Chrome MV3), verificando que la versión remota sea estrictamente superior antes de mostrar aviso de actualización y usando *Network-First* con respaldo offline en navegaciones de [sw.js](file:///projects/antigravity/mdeditor/pwa/sw.js).

### Cambiado
- Diseño responsive adaptado a móvil y tablet en [app.css](file:///projects/antigravity/mdeditor/src/styles/app.css), [AppShell.tsx](file:///projects/antigravity/mdeditor/src/components/AppShell.tsx), [TopToolbar.tsx](file:///projects/antigravity/mdeditor/src/components/TopToolbar.tsx) y [index.html](file:///projects/antigravity/mdeditor/index.html): barra superior en 2 filas sin solapamientos ni cortes (tira de formato desplazable horizontalmente), vista inicial en **Vista Previa** a ancho completo en pantallas `<= 768 px`, paneles laterales de Explorador/Índice convertidos en drawers deslizantes con cierre automático al seleccionar, modo **Dividida** apilado verticalmente, barra de estado compacta de una sola línea y soporte `100dvh` / `viewport-fit=cover`.

## [2026.11.15.5] - 2026-11-15

### Cambiado
- Restringida la apertura, selector de archivos, árbol de carpetas, arrastrar/soltar y `file_handlers` de la PWA exclusivamente a archivos Markdown (`.md`, `.markdown`, `.mdx`, `.mdown`), excluyendo ficheros `.txt`.

### Corregido
- Apertura de archivos `.md` desde el explorador de archivos del sistema operativo (Windows) en la PWA instalada (`file_handlers` / `launchQueue`): eliminada la condición de carrera con la restauración asíncrona de sesión en IndexedDB, añadida detección de duplicados mediante `isSameEntry()`, registrado temprano del consumidor `launchQueue`, `launch_handler` (`focus-existing`) en [manifest.webmanifest](file:///projects/antigravity/mdeditor/pwa/manifest.webmanifest) y coincidencia tolerante de caché en [sw.js](file:///projects/antigravity/mdeditor/pwa/sw.js).

## [2026.11.15.4] - 2026-11-15

### Añadido
- Botón **Instalar app** en la barra superior (`beforeinstallprompt`) cuando se ejecuta en modo PWA instalable.
- Documentación de política de privacidad ([PRIVACY.md](file:///projects/antigravity/mdeditor/PRIVACY.md)) y guía paso a paso para publicar en Chrome Web Store e instalar la PWA ([PUBLISHING.md](file:///projects/antigravity/mdeditor/PUBLISHING.md)).

### Cambiado
- Eliminado el bloque no utilizado `web_accessible_resources` en `<all_urls>` de [extension/manifest.json](file:///projects/antigravity/mdeditor/extension/manifest.json) y refinado [pwa/manifest.webmanifest](file:///projects/antigravity/mdeditor/pwa/manifest.webmanifest) (`id`, `purpose`, extensiones sin solapamiento).

### Corregido
- Empaquetado de `dist-extension.zip` en [finalize-extension.mjs](file:///projects/antigravity/mdeditor/scripts/finalize-extension.mjs) para situar `manifest.json` directamente en la raíz del archivo ZIP (requisito obligatorio de Chrome Web Store).

## [2026.11.15.3] - 2026-11-15

### Añadido
- Botón para cerrar/desmontar la carpeta abierta en la barra lateral, indicador `Cargando carpeta…` y soporte de carpetas en modo sólo lectura (`RO`, con respaldo automático a *Guardar como…*).

### Corregido
- Explorador lateral de carpetas refactorizado a carga instantánea nivel a nivel bajo demanda (`readDirectoryChildren`), excluyendo directorios pesados (`__pycache__`, `venv`, `.venv`, `envs`, `node_modules`) y tolerando enlaces simbólicos rotos o subcarpetas sin permisos.

## [2026.11.15.2] - 2026-11-15

### Cambiado
- Renombrado de **Vista Humana** a **Vista Previa** (`Preview` en inglés) en la interfaz, manifiestos, visor `.md`, documentación y módulo `src/editors/preview/` (`PreviewEditor`), manteniendo migración automática de sesiones previas.

### Corregido
- Sincronización bidireccional y externa entre **Raw** y **Vista Previa** al cambiar de idioma en la nota rápida sin modificar, cambiar de pestaña o modo de vista, y ante ediciones de Markdown incompleto transitorio.

## [2026.11.15.1] - 2026-11-15

### Añadido
- **Núcleo de edición bidireccional** (`Raw` con CodeMirror 6 ↔ `Vista Humana WYSIWYG` con TipTap v3) y modo **Pantalla Dividida** con sincronización de contenido y scroll proporcional (`Ctrl+1` / `Ctrl+2` / `Ctrl+3`).
- **Puente AST determinista** (`unified` / `remark`) con soporte completo para CommonMark, GFM (tablas editables con alineación, listas de tareas `[x]`), Frontmatter YAML, alertas GitHub (`[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`) y preservación de HTML directo.
- **Renderizado técnico local bajo demanda**: bloques de diagramas **Mermaid** editables en vivo y fórmulas matemáticas **LaTeX/KaTeX** inline (`$...$`) y en bloque (`$$...$$`) con fuentes `.woff2` empaquetadas localmente.
- **Imágenes autocontenidas en Base64**: pegar o arrastrar imágenes las incrusta como Data URI dentro del `.md`, con plegado visual en chips expandibles (`base64/<tipo> · <tamaño> [expandir]`) en vista Raw.
- **Productividad y espacio de trabajo**: pestañas, Nota rápida (Scratchpad) persistente, explorador lateral de carpetas mediante File System Access API (`Ctrl+S`, `Ctrl+O`), índice de encabezados (Outline), comandos `/` en Vista Humana, menú flotante de selección, paleta de comandos (`Ctrl+Shift+P`), Modo Zen (`Ctrl+Shift+Z`) y temas **Claro / Oscuro / Sepia**.
- **Exportación**: generación de HTML autocontenido, impresión/PDF limpio y copiado al portapapeles como texto enriquecido.
- **Empaquetado dual**:
  - **Extensión de Chromium (Manifest V3)** en `dist-extension/` y `dist-extension.zip` con editor en pestaña, Side Panel, menú contextual y visor automático para URLs `.md`/`.markdown`.
  - **PWA instalable offline** en `dist-pwa/` con `file_handlers` y Service Worker pre-cacheado.
- **Sistema i18n extensible** con idiomas iniciales Español (`es`) e Inglés (`en`).
- **Verificación automatizada**: suite Vitest (`tests/bridge.test.ts`, `tests/base64Fold.test.ts`, `tests/i18n.test.ts`) y prueba E2E en Google Chrome headless (`scripts/verify-e2e.mjs`).
