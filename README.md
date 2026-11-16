# PrismaMD — Editor Markdown Rápido y Bidireccional

Editor de archivos Markdown multiplataforma, ultrarrápido y 100% local (sin servidores remotos ni CDNs), compilado desde una única base de código en **Preact + TypeScript + CodeMirror 6 + TipTap v3** para funcionar tanto como **Extensión de Chromium (Manifest V3)** como **Aplicación Web Progresiva (PWA)** instalable offline.

---

## Características principales

- **Edición bidireccional real**:
  - **Raw (`Ctrl+1`)**: CodeMirror 6 con resaltado GFM, búsqueda/reemplazo Regex y **plegado visual inteligente** de imágenes Base64 largas en chips expandibles (`base64/png · XX KB [expandir]`).
  - **Pantalla Dividida (`Ctrl+2`)**: edición simultánea con sincronización instantánea Raw ↔ Vista Humana y scroll acoplado.
  - **Vista Humana WYSIWYG (`Ctrl+3`)**: edición visual directa con menú flotante al seleccionar texto, comandos rápidos `/`, barras de edición de tablas y controles de bloques técnicos.
- **Suite técnica completa (100% local y bajo demanda)**:
  - CommonMark + GFM (tablas con alineación de columnas, checklists `[x]`, tachado, resaltado de código con `lowlight`).
  - **Diagramas Mermaid** renderizados en SVG con editor de código inline (carga diferida local).
  - **Fórmulas matemáticas LaTeX/KaTeX** inline (`$...$`) y en bloque (`$$...$$`) con edición instantánea (carga diferida local).
  - **Alertas estilo GitHub** (`[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`).
  - **Frontmatter YAML** colapsable.
- **Archivos autocontenidos y disco local**:
  - Guardado manual directo en disco (`Ctrl+S`) mediante **File System Access API** + recuperación automática en IndexedDB.
  - Pegar (`Ctrl+V`) o arrastrar imágenes las incrusta como **Base64 / Data URI** en el propio `.md`.
  - **Pestañas + Nota rápida (Scratchpad) + Explorador lateral de carpeta + Índice (Outline)** colapsables.
- **Apariencia, productividad y exportación**:
  - Temas **Claro**, **Oscuro** y **Sepia**, **Modo Zen (`Ctrl+Shift+Z`)**, **Paleta de comandos (`Ctrl+Shift+P`)**.
  - Exportar a **HTML autocontenido**, **PDF / Impresión limpia** y **Copiar como texto enriquecido**.
  - **i18n extensible**: Español (`es`) e Inglés (`en`) incluidos de serie.

---

## Cómo usar como Extensión de Chromium / Chrome

1. Ejecuta `npm run build` (genera `dist-extension/` y `dist-extension.zip`).
2. Abre `chrome://extensions` en Google Chrome, Brave, Edge o Chromium.
3. Activa el **Modo de desarrollador** (esquina superior derecha).
4. Pulsa **Cargar descomprimida** y selecciona la carpeta `dist-extension/`.
5. *(Opcional recomendado)* En los detalles de la extensión, activa **"Permitir acceso a URLs de archivo"** para que cualquier archivo `file:///*.md` que abras en el navegador se renderice automáticamente con el visor y el botón **"Abrir y editar en PrismaMD"**.

Incluye además **Side Panel** lateral (clic derecho en cualquier página → *"Abrir PrismaMD en panel lateral"* o *"Enviar selección a Nota rápida"*).

---

## Cómo usar como PWA de escritorio (Linux / Windows / macOS)

1. Sirve la carpeta `dist-pwa/` localmente (`npm run preview:pwa`) o publícala en cualquier servidor estático HTTPS.
2. Ábrela en Chromium/Chrome/Edge y pulsa el icono **Instalar aplicación** en la barra de direcciones.
3. Quedará instalada como ventana independiente con soporte 100% offline y asociación directa con archivos `.md` / `.markdown`.

---

## Atajos de teclado

| Acción | Atajo |
| :--- | :--- |
| Vista Raw / Dividida / Humana | `Ctrl+1` / `Ctrl+2` / `Ctrl+3` |
| Guardar en disco / Guardar como | `Ctrl+S` / `Ctrl+Shift+S` |
| Abrir archivo `.md` | `Ctrl+O` |
| Paleta de comandos | `Ctrl+Shift+P` |
| Modo Zen sin distracciones | `Ctrl+Shift+Z` |
| Buscar y reemplazar (en Raw) | `Ctrl+F` / `Ctrl+H` |
| Insertar bloque (en Vista Humana) | `/` |

---

## Cómo añadir más idiomas (`i18n`)

1. Copia `src/i18n/locales/en.ts` a `src/i18n/locales/<codigo>.ts` y traduce los valores manteniendo la interfaz `TranslationDictionary`.
2. Registra el nuevo idioma en `src/i18n/index.ts` llamando a `registerLocale({ code: '<codigo>', nativeName: 'Nombre', dir: 'ltr' }, dict)`.
3. Ejecuta `npm run test` para verificar automáticamente la paridad completa de claves.

---

## Scripts de desarrollo

```bash
npm run dev        # Servidor de desarrollo Vite
npm run test       # Tests unitarios (puente AST, plegado Base64, paridad i18n)
npm run typecheck  # Comprobación estricta de tipos TypeScript
npm run build      # Compila dist-pwa/, dist-extension/ y dist-extension.zip
```

---

## Licencia

Distribuido bajo licencia **MIT** — consulta el archivo [LICENSE](LICENSE) para más detalles.

Copyright © 2026 **Guillem Martorell Nicolau**. Cualquier copia, redistribución o trabajo derivado debe conservar el aviso de copyright y citar al autor original.
