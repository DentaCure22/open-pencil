# Native external-design bridge

Use this bridge when a board needs stronger layout discipline than freehand scene-node generation is producing.

## Preferred path

1. Start from the real product capture and the user's decision.
2. Choose a strict CSS token grammar with an 8 px outer rhythm and 4 px compact subgrid.
3. Author a single-purpose HTML/CSS composition.
4. Choose the output deliberately:
   - Place it as a live HTML board when exact browser spacing or interaction is required.
   - Import it into a native `.fig` document when individual scene-node editing is more important than exact browser layout.
5. Inspect the imported frames and text, export a screenshot, and run the normal screenshot critic.
6. Merge or place the native document on the explicit target page only after the visual gate passes.

The live path keeps browser geometry and interaction exact. The native path keeps text, frames, layout, fills, strokes, effects, and embedded images individually editable. Both are preferred over importing a flattened screenshot from an external AI design generator.

## Borrow principles, not skins

- Tailwind supplies a compact token and utility interface.
- Carbon supplies the 8 px rhythm, limited spacing scale, and alignment discipline.
- Radix Themes supplies layout primitives and the separation of layout responsibility from content.
- Smylr supplies the visual identity, language, real component evidence, and product truth.

Do not reproduce Carbon, Radix, shadcn, Figma, or Notion branding. Do not use their default dashboard templates as the board's visual identity.

## Import gate

- Native `.fig` output opens successfully.
- Real captures are embedded as image fills, not unresolved external URLs.
- Surface nesting is one level or less.
- The first review view gives the real capture at least 55% of the main visual row.
- Text uses no more than four sizes in a compact review view.
- All major spacing is on the 8 px grid; 4 px is reserved for tight internal relationships.
- Export and inspect the rendered result before placing it on the live board.

The reference implementation lives at `native-layout-kit/` in the Open Pencil workspace.
