# Univer Office surface attribution

OpenPencil's Document and Spreadsheet Code Objects use the following Apache License 2.0
packages from DreamNum's Univer projects:

- `@univerjs/core`
- `@univerjs/themes`
- `@univerjs/preset-docs-core`
- `@univerjs/preset-sheets-core`

Source:

- https://github.com/dream-num/univer
- https://github.com/dream-num/univer-presets

The Univer runtime is mounted inside an ordinary persisted OpenPencil Code Object. OpenPencil
owns board placement, transforms, source retention, and the Design/Interaction boundary.
Univer owns focused document and spreadsheet editing inside that shape. Univer Slides is not
used because its upstream documentation currently marks it as not production-ready.
