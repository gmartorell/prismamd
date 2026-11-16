# Guía de Publicación en Chrome Web Store e Instalación de la PWA

## 1. Publicar la Extensión en Chrome Web Store

### Requisitos previos
1. Cuenta de desarrollador en [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) (cuota única de registro de USD 5).
2. Paquete compilado con `manifest.json` en la raíz del ZIP:
   ```bash
   export PATH="/home/odoo/.local/nodejs/bin:$PATH"
   npm run build
   ```
   Esto genera el archivo listo para subir: **`dist-extension.zip`**.

### Pasos en Chrome Web Store Developer Dashboard
1. Pulsa **+ Nuevo elemento** (*New item*) y sube `dist-extension.zip`.
2. **Ficha de Chrome Web Store (*Store Listing*)**:
   - **Nombre**: `PrismaMD — Fast Markdown Editor`
   - **Resumen** (<= 132 caracteres, ya sincronizado en `extension/manifest.json`):
     `Editor Markdown rápido y bidireccional (Raw + Vista Previa WYSIWYG + Mermaid + KaTeX) con Panel Lateral y Visor .md.`
   - **Categoría**: Productividad (*Productivity*) / Herramientas de desarrollo.
   - **Icono**: `dist-extension/icons/icon-128.png`.
   - **Capturas de pantalla**: sube al menos 1 captura en `1280×800` o `640×400`.
3. **Prácticas de privacidad (*Privacy practices*)**:
   - **Propósito único (*Single purpose*)**:
     > *Editor y visor de archivos Markdown local (offline) con edición bidireccional Raw y Vista Previa WYSIWYG, panel lateral y renderizado local de diagramas Mermaid y fórmulas KaTeX.*
   - **Justificación de permisos**:
     - `storage`: transferir localmente el contenido desde el visor `.md` o el menú contextual hacia la pestaña del editor sin enviar datos a internet.
     - `sidePanel`: permitir abrir el editor en el panel lateral de Chrome mientras se consulta cualquier página.
     - `contextMenus`: permitir enviar texto seleccionado desde una página web a la Nota rápida local.
     - **Acceso de host / scripts en `*.md` y `*.markdown`**: transformar archivos Markdown sin formato abiertos en el navegador en una vista legible mediante Shadow DOM 100 % local, con botón directo para editarlos en PrismaMD.
   - **Uso de datos**: marca que **no se recopilan datos de usuario** y enlaza la URL pública donde alojes [PRIVACY.md](file:///projects/antigravity/mdeditor/PRIVACY.md).
4. **Código remoto**: confirma que **no utiliza código remoto** (`Zero-CDN`, todo va empaquetado localmente en `dist-extension/`).
5. Pulsa **Enviar para revisión** (*Submit for review*). Al haber reglas en `*://*/*.md`, la revisión manual de Google suele tardar entre **2 y 7 días hábiles**.

---

## 2. Cómo Instalar la PWA (Aplicación de Escritorio / Móvil)

La PWA se genera en **`dist-pwa/`** e incluye Service Worker offline (`sw.js`), icono vector/PNG y soporte `file_handlers` para abrir archivos `.md` directamente como app instalada.

> **Importante**: Los navegadores solo permiten instalar una PWA desde un **origen seguro** (`https://...` o `http://localhost`), nunca abriendo `index.html` con `file://`.

### Opción A — Instalación local inmediata en este equipo
1. Compila y levanta el servidor local de vista previa:
   ```bash
   export PATH="/home/odoo/.local/nodejs/bin:$PATH"
   npm run build:pwa
   npm run preview:pwa
   ```
2. Abre **`http://localhost:4173`** en Google Chrome o Microsoft Edge.
3. Haz clic en el botón **"Instalar app"** de la barra superior de PrismaMD (o en el icono **Instalar** a la derecha de la barra de direcciones de Chrome / menú ⋮ → *Guardar y compartir* → *Instalar página como app…*).
4. Una vez instalada, se abrirá en su propia ventana independiente y funcionará **100 % offline**, incluso si cierras el servidor `preview:pwa`.

### Opción B — Despliegue HTTPS para instalar desde cualquier dispositivo
Como `dist-pwa/` es un sitio estático puro con rutas relativas (`./`), basta con subir su contenido a cualquier hosting HTTPS gratuito:
- **GitHub Pages** / **Cloudflare Pages** / **Netlify** / **Vercel** (carpeta de publicación: `dist-pwa/`).
- Ejemplo rápido con Cloudflare Wrangler o Netlify CLI, o subiendo directamente la carpeta `dist-pwa/` por arrastrar y soltar en Netlify Drop.
- Tras abrir la URL `https://...` en Chrome, Edge o navegador móvil compatible, pulsa **"Instalar app"** para fijarla en el sistema operativo.
