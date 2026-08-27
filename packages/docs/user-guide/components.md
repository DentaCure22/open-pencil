---
title: Legacy Figma Components
description: How OpenPencil treats component, component-set, and instance nodes imported from Figma.
---

# Legacy Figma Components

OpenPencil still imports, renders, and exports Figma `COMPONENT`, `COMPONENT_SET`, and `INSTANCE` nodes so existing files retain their appearance and metadata.

These nodes are compatibility data, not first-class OpenPencil authoring objects. The Board does not expose commands, shortcuts, Assets entries, or agent tools for creating components, sets, or instances.

For new reusable or app-like work, use a [Code Object](/guide/features) preset. Presets are grouped by modality and keep their source, state, interaction model, and Board placement in one durable object. A dedicated design-system modality is planned for reusable UI catalogs, variants, and tokens.

Generic layer editing still works on imported nodes, and `.fig` round-trip preserves component metadata and overrides where supported.
