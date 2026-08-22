---
title: Scripting
description: Execute JavaScript with a Figma-compatible Plugin API to query, batch-modify, and generate designs.
---

# Scripting

`openpencil eval` runs JavaScript against an OpenPencil document with a Figma-compatible `figma` global. Use it for headless batch edits, inspection, fixture setup, and automation without opening the editor UI.

## Basic usage

```sh
openpencil eval design.fig -c "return figma.currentPage.children.length"
```

The `-c` flag accepts JavaScript. If the code does not start with `return`, OpenPencil wraps it in an async function and returns the value from that function when present.

```sh
openpencil eval design.fig -c "
  const frame = figma.createFrame()
  frame.name = 'Card'
  frame.resize(300, 200)
  frame.layoutMode = 'VERTICAL'
  frame.itemSpacing = 12
  return { id: frame.id, name: frame.name }
"
```

## Query nodes

```sh
openpencil eval design.fig -c "
  return figma.currentPage
    .findAll((node) => node.type === 'FRAME' && node.name.includes('Button'))
    .map((button) => ({
      id: button.id,
      name: button.name,
      width: button.width,
      height: button.height
    }))
"
```

## Modify and save

Use `--write` / `-w` to write changes back to the input file:

```sh
openpencil eval design.fig -c "
  figma.currentPage.children.forEach((node) => {
    node.opacity = 0.5
  })
" --write
```

Use `--output` / `-o` to write to a new file:

```sh
openpencil eval design.fig -c "figma.currentPage.name = 'Updated'" -o updated.fig
```

## Read scripts from stdin

```sh
cat transform.js | openpencil eval design.fig --stdin --write
```

## Live and persisted Board automation

Live-app `eval` is disabled. Use the guarded Board namespace for exact-target automation:

```sh
openpencil board list --limit 10 --json
openpencil board context --workspace-id <workspace> --page-id <page> --json
openpencil board search "prior pricing work" --limit 10 --json
openpencil board get 0:35 --json
openpencil board ls --json
openpencil board nearby 0:35 --json
openpencil board create --name "Agent Sandbox" --request-id <stable-id> --json
```

Persisted local authority supports list, context, page creation, and exact saved-target resolution
without an open editor. `board create` automatically uses the sole persisted workspace/document;
optional target flags pin and validate it, and ambiguity fails before mutation. An authority-pinned
`board open` queues a short-lived exact page switch for
the next matching editor; it does not require or imply pixel proof.

## Output

By default, non-TTY output is JSON. Use `--json` to force JSON output:

```sh
openpencil eval design.fig -c "return figma.currentPage.children.map((n) => n.name)" --json
```

Use `--quiet` / `-q` to suppress output when only writing a file.

## Supported API surface

The API is intentionally close to Figma's Plugin API, but it maps to OpenPencil's scene graph and file format.

### Document and pages

- `figma.root`
- `figma.currentPage`
- `figma.currentPage.selection`
- `figma.getNodeById(id)`
- `figma.createPage()`

### Node creation

- `figma.createFrame()`
- `figma.createRectangle()`
- `figma.createEllipse()`
- `figma.createText()`
- `figma.createLine()`
- `figma.createPolygon()`
- `figma.createStar()`
- `figma.createVector()`
- `figma.createComponent()`
- `figma.createSection()`

### Tree operations

- `node.children`
- `node.parent`
- `node.appendChild(child)`
- `node.insertChild(index, child)`
- `node.clone()`
- `node.remove()`
- `node.findAll(callback?)`
- `node.findOne(callback)`
- `node.findChild(callback)`
- `node.findChildren(callback?)`
- `figma.group(nodes, parent)`
- `figma.ungroup(node)`

### Components

- `figma.createComponentFromNode(node)`
- `component.createInstance()`
- `instance.mainComponent`

### Variables

- `figma.getLocalVariables(type?)`
- `figma.getVariableById(id)`
- `figma.getLocalVariableCollections()`
- `figma.getVariableCollectionById(id)`
- `figma.createVariable(name, type, collectionId, value?)`
- `figma.setVariableValue(variableId, modeId, value)`
- `figma.deleteVariable(id)`
- `figma.createVariableCollection(name)`
- `figma.deleteVariableCollection(id)`
- `figma.bindVariable(nodeId, field, variableId)`
- `figma.unbindVariable(nodeId, field)`

### Properties

Common node properties are readable/writable through the proxy, including:

- Geometry: `x`, `y`, `width`, `height`, `rotation`, `resize(width, height)`
- Appearance: `fills`, `strokes`, `effects`, `opacity`, `visible`, `locked`, `blendMode`, `clipsContent`
- Radius: `cornerRadius`, `topLeftRadius`, `topRightRadius`, `bottomRightRadius`, `bottomLeftRadius`
- Text: `characters`, `fontSize`, `fontName`, `fontWeight`, alignment, line height, letter spacing, style-run helpers
- Auto-layout: `layoutMode`, `primaryAxisAlignItems`, `counterAxisAlignItems`, `itemSpacing`, padding, sizing, and layout positioning fields
- Stroke helpers: `strokeWeight`, `strokeAlign`, `dashPattern`

### Utilities

- `figma.mixed`
- `figma.createImage(data)`
- `figma.loadFontAsync(fontName)` no-ops because OpenPencil does not gate text edits on plugin font loading
- `figma.listAvailableFontsAsync()` returns host-provided fonts when available
- `figma.notify(message)` logs a warning in headless mode
- `figma.viewport`

## Not yet Figma-compatible

These Figma APIs are not exposed as compatible helpers yet:

- `node.exportAsync()`
- `node.setBoundVariable(field, variable)`
- `node.detachInstance()`
- `figma.combineAsVariants(components, parent)`
- Figma style APIs such as `figma.createPaintStyle()` / `figma.createTextStyle()`
- Full vector boolean operation parity

Use OpenPencil CLI export commands, core tools, or direct scene-graph helpers where available.
