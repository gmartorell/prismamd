# AGENTS.md — Guía de Arquitectura y Consistencia de PrismaMD

Este documento define la visión, las decisiones técnicas e invariantes obligatorios que cualquier agente o colaborador debe respetar al modificar **PrismaMD**.

---

## 1. Visión del Producto

**PrismaMD** es un editor de archivos Markdown multiplataforma diseñado bajo cuatro pilares no negociables:

1. **Rapidez real y arranque instantáneo**: UI ultraligera en **Preact + TypeScript**; dependencias pesadas (`mermaid`, `katex`) cargadas estrictamente bajo demanda mediante `import()` dinámico.
2. **Edición bidireccional auténtica (`Raw` ↔ `Dividida` ↔ `Vista Previa`)**:
   - **Raw** (CodeMirror 6) mantiene el Markdown fiel al archivo en disco.
   - **Vista Previa** (TipTap v3 / ProseMirror) ofrece edición WYSIWYG directa con comandos `/`, menú flotante sobre selección y controles visuales para tablas, tareas, diagramas y ecuaciones.
3. **100% local, offline y autocontenido (Zero-CDN)**:
   - Prohibido cargar scripts, estilos o fuentes desde URLs remotas (`https://...`). Todo se empaqueta localmente para cumplir con la CSP `script-src 'self'` de Chromium Manifest V3 y el modo offline de la PWA.
   - Las imágenes pegadas o arrastradas se incrustan como `data:image/...;base64,...` dentro del propio `.md`, plegándose visualmente en chips interactivos en la vista Raw.
   - El guardado en disco (`Ctrl+S`) es explícito/manual mediante File System Access API, respaldado por recuperación anti-cierres en IndexedDB.
4. **Un único código base, dos formatos de entrega**:
   - **Extensión de Chromium MV3** (`dist-extension/`, `dist-extension.zip`): pestaña completa, Side Panel lateral, menú contextual y visor automático de archivos `.md` / `.markdown`.
   - **PWA instalable** (`dist-pwa/`): ventana independiente con `file_handlers` y Service Worker offline.

---

## 2. Mapa del Repositorio

| Ruta | Responsabilidad |
| :--- | :--- |
| `src/markdown/bridge.ts` | Puente AST determinista `Markdown <-> mdast <-> ProseMirror JSON` (`unified` + `remark-*`), outline y métricas. |
| `src/markdown/imageDataUri.ts` | Conversión de imágenes a Base64 Data URI y cálculo de tamaños. |
| `src/editors/raw/RawEditor.tsx` | Editor CodeMirror 6 con búsqueda/reemplazo, diff mínimo y guardia de sincronización externa. |
| `src/editors/raw/base64FoldExtension.ts` | `ViewPlugin` que pliega cadenas `data:image/...;base64,...` largas en chips expandibles. |
| `src/editors/preview/PreviewEditor.tsx` | Instancia TipTap v3 + NodeViews técnicos + Bubble Menu + Slash `/` Menu + barra de tablas. |
| `src/editors/preview/nodes/` | Extensiones ProseMirror para Frontmatter YAML, Alertas GitHub, Mermaid, KaTeX y HTML passthrough. |
| `src/renderers/` | Carga diferida de `mermaid` y `katex` (incluidas fuentes locales). |
| `src/workspace/fileSystem.ts` | File System Access API (archivos y carpetas), IndexedDB (`idb-keyval`), `launchQueue` y handoff con la extensión. |
| `src/utils/exporter.ts` | Exportación a HTML autocontenido, impresión/PDF y copia como texto enriquecido. |
| `src/i18n/` | Sistema tipado de localización (`types.ts`, `locales/es.ts`, `locales/en.ts`, `index.ts`). |
| `src/components/` | `AppShell.tsx`, `TopToolbar.tsx`, `TabBar.tsx`, `FolderSidebar.tsx`, `OutlineSidebar.tsx`, `CommandPalette.tsx`, `StatusBar.tsx`. |
| `src/styles/app.css` | Sistema visual para temas `light`, `dark` y `sepia`, layout Side Panel y reglas `@media print`. |
| `extension/` | `manifest.json` (MV3), `background.ts` (Service Worker) y `mdViewerContent.ts` (visor Shadow DOM para `.md`). |
| `pwa/` | `manifest.webmanifest` y plantilla `sw.js` del Service Worker offline. |
| `scripts/` | Finalizadores de build (`finalize-pwa.mjs`, `finalize-extension.mjs`, `generate-icons.mjs`), `release.mjs` y `verify-e2e.mjs`. |
| `tests/` | Tests unitarios Vitest (`bridge.test.ts`, `base64Fold.test.ts`, `i18n.test.ts`, `release.test.ts`). |

---

## 3. Invariantes Técnicos (No Romper)

1. **Guardia contra bucles infinitos de sincronización**:
   - En `RawEditor.tsx`, toda actualización externa se despacha con `ExternalSyncAnnotation.of(true)` y `onChange` la ignora.
   - En `PreviewEditor.tsx`, toda sincronización externa marca la transacción con `.setMeta('externalSync', true).setMeta('addToHistory', false)` y `onUpdate` la ignora.
   - Al abrir un archivo en Raw o Pantalla Dividida, no se debe reescribir el texto Raw hasta que el usuario edite realmente.
2. **Preact vs `contentDOM` de ProseMirror**:
   - Para nodos contenedores con contenido rico editable (como `githubAlert`), construir `{ dom, contentDOM }` con DOM nativo (`document.createElement`). **Nunca** montar VDOM de Preact sobre un elemento `contentDOM`.
   - Usar `render()` de Preact únicamente en nodos hoja/átomo (`frontmatter`, `mermaidBlock`, `mathInline`, `mathBlock`, `rawHtmlBlock`) implementando `stopEvent` para controles internos e `ignoreMutation: () => true`.
3. **Regla de saltos de línea en CodeMirror 6**:
   - En `base64FoldExtension.ts`, las decoraciones `Decoration.replace` dentro de un `ViewPlugin` **nunca** deben cruzar `\n`. Analizar siempre línea por línea dentro de `view.visibleRanges`.
4. **Listas de tareas en TipTap v3**:
   - `@tiptap/extension-list` (`TaskItem`) renderiza `<li data-checked="...">` directamente bajo `ul[data-type="taskList"]` sin añadir `data-type="taskItem"` en el NodeView. Mantener los selectores CSS (`ul[data-type='taskList'] > li`) y tests sincronizados con esa estructura.
5. **Listas mixtas y Alertas GitHub en el puente AST (`src/markdown/bridge.ts`)**:
   - Si un bloque `list` de `mdast` mezcla ítems normales y checklists (`- [x]`), deben partirse en grupos contiguos separados (`bulletList` y `taskList`).
   - El marcador `[!NOTE|TIP|IMPORTANT|WARNING|CAUTION]` al serializar debe emitirse como nodo `html` inline para evitar que `remark-stringify` escape el corchete (`\[!TIP]`).
6. **Restricciones de Chromium MV3**:
   - `extension/background.ts` y `extension/mdViewerContent.ts` deben compilarse como `iife` autocontenidos (`esbuild` en `scripts/finalize-extension.mjs`), sin `import` ESM ni referencias remotas.
   - El Service Worker `sw.js` solo se registra cuando `__BUILD_TARGET__ === 'pwa'` y el protocolo es `http:` o `https:`.

---

## 4. Reglas de Idioma (`i18n`) y Apariencia

- **Cero textos hardcoded en la interfaz**: cualquier etiqueta visible nueva debe añadirse en `src/i18n/types.ts` y traducirse en **todos** los diccionarios bajo `src/i18n/locales/` (`es.ts`, `en.ts`, etc.).
- Para incorporar un nuevo idioma, basta con crear `src/i18n/locales/<codigo>.ts` e inscribirlo mediante `registerLocale(...)` en `src/i18n/index.ts`.
- Cualquier componente o bloque nuevo debe usar las variables CSS de `src/styles/app.css` para verse correctamente en los tres temas: `light`, `dark` y `sepia`.

---

## 5. Flujo de Versionado y `CHANGELOG.md`

- **Esquema de versión obligatorio**: **`año.mes.dia.versiondiaria`** (sin ceros a la izquierda, p. ej. `2026.11.15.1`, `2026.11.15.2`, `2026.12.1.1`). Este formato es válido directamente como entero cuatripartito en `extension/manifest.json` para Chromium MV3.
- **Cómo registrar y publicar cambios**:
  1. Mientras desarrollas cambios, anota las entradas bajo `## [Unreleased]` en `CHANGELOG.md` agrupadas en `### Añadido`, `### Cambiado`, `### Corregido` o `### Eliminado`.
  2. Cuando vayas a publicar una nueva versión, ejecuta:
     ```bash
     npm run release
     ```
     *(O con nota directa y compilación automática: `node scripts/release.mjs --note "Descripción del cambio" --build`)*
  3. El script `scripts/release.mjs` calcula automáticamente el siguiente `año.mes.dia.versiondiaria` del día, mueve `[Unreleased]` (o las notas / commits pendientes) a la nueva sección fechada de `CHANGELOG.md` y sincroniza la versión en `extension/manifest.json`, `pwa/sw.js` y `package.json`.

---

## 6. Verificación Obligatoria Antes de Dar por Terminado un Cambio

En este entorno Linux, si `node`/`npm` no están en el `PATH` de una sesión nueva, anteponer `/home/odoo/.local/nodejs/bin`:

```bash
export PATH="/home/odoo/.local/nodejs/bin:$PATH"
npm run test             # Tests unitarios (AST, Base64 folding, paridad i18n, versionado)
npm run build            # tsc --noEmit + dist-pwa/ + dist-extension/ + dist-extension.zip
node scripts/verify-e2e.mjs   # E2E real en Google Chrome headless (0 errores consola/página)
```
