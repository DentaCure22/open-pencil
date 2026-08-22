# Características

## Archivos .fig de Figma

Abre y guarda archivos nativos de Figma directamente. El pipeline de importación/exportación usa el mismo códec binario Kiwi que Figma — 194 definiciones de esquema, ~390 campos por nodo. Guardar con <kbd>⌘</kbd><kbd>S</kbd>, Guardar como con <kbd>⇧</kbd><kbd>⌘</kbd><kbd>S</kbd>.

**Copiar y pegar con Figma** — selecciona nodos en Figma, <kbd>⌘</kbd><kbd>C</kbd>, cambia a OpenPencil, <kbd>⌘</kbd><kbd>V</kbd>. Rellenos, trazos, auto-layout, texto, efectos, radios de esquina y redes vectoriales se preservan. Funciona en ambas direcciones.

## Dibujo y edición

- **Formas** — Rectángulo (<kbd>R</kbd>), Elipse (<kbd>O</kbd>), Línea (<kbd>L</kbd>), Polígono, Estrella
- **Herramienta pluma** — redes vectoriales (no rutas simples), curvas de Bézier con asas de tangente
- **Texto** — edición nativa en el canvas con soporte IME, doble clic para entrar en modo de edición
- **Texto enriquecido** — negrita por carácter (<kbd>⌘</kbd><kbd>B</kbd>), cursiva (<kbd>⌘</kbd><kbd>I</kbd>), subrayado (<kbd>⌘</kbd><kbd>U</kbd>), tachado
- **Auto-layout** — flexbox vía Yoga WASM: dirección, gap, padding, justify, align, dimensionado de hijos. <kbd>⇧</kbd><kbd>A</kbd> para alternar
- **Componentes** — crear (<kbd>⌥</kbd><kbd>⌘</kbd><kbd>K</kbd>), conjuntos de componentes (<kbd>⇧</kbd><kbd>⌘</kbd><kbd>K</kbd>), instancias con soporte de overrides, sincronización en vivo
- **Variables** — tokens de diseño con colecciones, modos (Claro/Oscuro), tipos color/float/string/boolean, vinculación de variables
- **Secciones** — contenedores organizacionales con adopción automática de hijos y píldoras de título

## Espacio de trabajo y controles de objeto

La barra lateral flotante reúne Capas, Chats, Recursos y Actividad. Las acciones específicas del objeto permanecen junto al lienzo y en la barra de herramientas integrada. En pantallas estrechas, el cajón móvil muestra los controles de Diseño y el código fuente de los Code Objects que lo admiten.

## Renderizado

Skia (CanvasKit WASM) — el mismo motor de renderizado que Figma:

- Rellenos de gradiente (lineal, radial, angular, diamante)
- Rellenos de imagen con modos de escala
- Efectos con caché por nodo
- Datos de arco (elipses parciales, donuts)
- Culling de viewport y reutilización de Paint
- Guías de snap con alineación consciente de rotación
- Reglas del canvas con badges de selección
- Resaltado al pasar que sigue la geometría real

## Deshacer/Rehacer

Toda operación es deshacible — creación, eliminación, movimientos, redimensionamientos, cambios de propiedades, cambios de padre, cambios de layout, operaciones de variables. Usa un patrón de comando inverso. <kbd>⌘</kbd><kbd>Z</kbd> / <kbd>⇧</kbd><kbd>⌘</kbd><kbd>Z</kbd>.

## Documentos multi-página

Añadir, eliminar, renombrar páginas. Cada página tiene estado de viewport independiente. Doble clic para renombrar en línea.

## Pestañas multi-archivo

Abre múltiples documentos en pestañas. <kbd>⌘</kbd><kbd>T</kbd> nueva pestaña, <kbd>⌘</kbd><kbd>W</kbd> cerrar, <kbd>⌘</kbd><kbd>O</kbd> abrir archivo.

## Exportación

- **Imagen** — PNG, JPG, WEBP a escala configurable (0,5×–4×). Vía panel, menú contextual, o <kbd>⇧</kbd><kbd>⌘</kbd><kbd>E</kbd>
- **SVG** — formas, texto con style runs, gradientes, efectos, modos de mezcla
- **Tailwind JSX** — HTML con clases de utilidad Tailwind v4, listo para React o Vue
- **Copiar como** — texto, SVG, PNG (<kbd>⇧</kbd><kbd>⌘</kbd><kbd>C</kbd>), o JSX vía menú contextual

CLI: `openpencil export design.fig -f jsx --style tailwind`

## Chat de tareas

Abre **CHATS** en la barra lateral izquierda para iniciar o continuar una tarea de programación con Pi. La barra lateral y las tarjetas del Board comparten conversación, modelo, herramientas, adjuntos y seguimientos.

Las herramientas activas permanecen abiertas; la actividad terminada se resume de forma compacta.

Consulta [Chat de tareas](/programmable/ai-chat).

## Servidor MCP

Conecta Claude Code, Cursor, Windsurf o cualquier cliente MCP para leer y escribir archivos `.fig` sin interfaz. Los clientes descubren el catálogo actual en tiempo de ejecución mediante stdio o HTTP.

```sh
npm install -g @open-pencil/mcp
```

```json
{
  "mcpServers": {
    "open-pencil": {
      "command": "openpencil-mcp"
    }
  }
}
```

Consulta la [referencia de herramientas MCP](/programmable/mcp-server) para la lista completa.

## CLI

Inspecciona, exporta y analiza archivos `.fig` desde el terminal:

```sh
openpencil tree design.fig          # Árbol de nodos
openpencil find design.fig --type TEXT  # Buscar
openpencil export design.fig -f png     # Renderizar
openpencil analyze colors design.fig    # Auditoría de colores
openpencil analyze clusters design.fig  # Patrones repetidos
openpencil eval design.fig -c "..."     # Figma Plugin API
```

Cuando la app de escritorio está en ejecución, omite el archivo para controlar el editor en vivo vía RPC:

```sh
openpencil tree                     # Documento en vivo
openpencil export -f png            # Captura del canvas
```

Todos los comandos soportan `--json`. Instalar: `npm install -g @open-pencil/cli`

## Colaboración en tiempo real

P2P vía WebRTC — sin servidor requerido. Comparte un enlace y edita junto.

- Cursores en vivo con flechas de colores y píldoras de nombre
- Avatares de presencia
- Modo seguimiento — clic en un par para seguir su viewport
- Persistencia local vía IndexedDB
- IDs de sala seguros vía `crypto.getRandomValues()`

## Escritorio y web

**Escritorio** — Tauri v2, ~7 MB. macOS (firmado y notarizado), Windows, Linux. Menús nativos, offline, autoguardado.

**Web** — funciona en [app.openpencil.dev](https://app.openpencil.dev), instalable como PWA en móvil con interfaz optimizada para táctil.

**Homebrew:**

```sh
brew install open-pencil/tap/open-pencil
```

## Fallback de Google Fonts

Cuando una fuente no está disponible localmente, OpenPencil la carga automáticamente desde Google Fonts. No requiere instalación manual al abrir archivos .fig con fuentes desconocidas.
