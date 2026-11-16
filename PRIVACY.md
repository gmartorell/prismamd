# Política de Privacidad de PrismaMD

**Última actualización:** 15 de noviembre de 2026

**PrismaMD** está diseñado con una arquitectura **100 % local y sin servidores (Zero-CDN / Offline-First)**.

## 1. Datos recopilados y transmitidos
- **Ninguno.** PrismaMD no recopila, analiza, transmite ni vende datos personales, telemetría de uso, historial de navegación ni el contenido de tus documentos Markdown.
- Todo el procesamiento (edición, conversión AST, renderizado de diagramas Mermaid, fórmulas matemáticas KaTeX e incrustación de imágenes Base64) se ejecuta íntegramente en tu navegador.
- No se realizan peticiones de red remotas ni se cargan scripts o fuentes desde CDN externos.

## 2. Almacenamiento local en el dispositivo
PrismaMD utiliza exclusivamente almacenamiento local del navegador bajo tu control:
- **`localStorage` / `IndexedDB`**: preferencias de interfaz (tema, idioma, modo de vista) y recuperación local de pestañas abiertas.
- **File System Access API**: acceso directo y manual a los archivos y carpetas locales que selecciones explícitamente para leer o guardar en disco.
- **`chrome.storage.local`** *(solo en la extensión de Chromium)*: transferencia temporal en memoria local cuando pulsas *"Abrir y editar en PrismaMD"* en el visor `.md` o usas el menú contextual *"Enviar selección a PrismaMD"*.

## 3. Permisos de la extensión (Chromium Manifest V3)
- `storage`: guardar borradores temporales al transferir un documento o selección desde el visor integrado hacia el editor.
- `sidePanel`: abrir PrismaMD en el panel lateral del navegador.
- `contextMenus`: añadir la acción del menú contextual para enviar texto seleccionado a la Nota rápida.
- Scripts de contenido (`file://*/*.md`, `file://*/*.markdown`, `*://*/*.md`, `*://*/*.markdown`): renderizar archivos `.md` / `.markdown` en una vista legible local sin extraer ni enviar información fuera del navegador.

## 4. Contacto
Si tienes dudas sobre privacidad o seguridad, puedes consultar el código fuente del proyecto o contactar con el responsable de publicación indicado en la ficha de Chrome Web Store.
