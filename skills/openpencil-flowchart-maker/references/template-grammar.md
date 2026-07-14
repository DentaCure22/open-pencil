# Flow Chart Kit Grammar

Use this reference to translate the duplicated Figma Flow Chart kit into consistent OpenPencil compositions. The source is file key `OEpZ66fGl7KqlbcbAiRrUc`.

## Primitive roles

| Primitive | Meaning | Use | Avoid |
| --- | --- | --- | --- |
| `Page` | Persistent destination, screen, or major step | Main product states, sitemap pages, durable process stages | Temporary UI or tiny sub-actions |
| `Modal` | Temporary overlay or interruption | Confirmations, blockers, focused dialogs | Treating every state as a modal |
| `Choice` | Decision point | Questions with two or a few explicit exits | Using it for a normal action step |
| `Option` | Selectable or alternate route | Branch choices beneath a decision | Repeating the decision text |
| `Section` | Meaningful phase, domain, or group | Journey phases, sitemap domains, workshop stages | Decorative card behind every cluster |
| `Quote` | Direct evidence or human insight | One short persona or research insight | Long testimonial blocks |
| `Label` | Brief orientation or relationship text | Phase names, connector decisions, small metadata | Paragraphs and redundant captions |
| `Check` | Confirmed completion or success | Verified outcome, completed milestone | General decoration or bullet icons |
| `Straight` | Compact direct relationship | Sitemaps, grids, short adjacent links | Long routes through several objects |
| `Curve` | Secondary or returning relationship | Feedback loops, cross-links, annotations | Primary routes when a straight flow is clearer |
| `Flow` | Directional journey transition | Primary processes and product journeys | Dense many-to-many graphs |

## Shared visual grammar

- Use a 4- or 8-unit spacing base consistently.
- Give repeated nodes equal widths and content-driven heights.
- Keep node labels optically centered and internal padding equal on opposite sides.
- Use thin neutral borders and one stronger accent for the active path.
- Prefer subtle surface contrast over shadows. If shadows are present, use one quiet elevation style.
- Use one corner-radius family for peers. A decision shape may differ only when the distinction improves scanning.
- Attach connectors to stable edge anchors and show direction consistently.
- Keep nodes directly on the canvas unless a `Section` conveys a real phase or domain.

## Example composition: linear or decision flow

Place the primary route on one horizontal axis:

`Page → Page → Choice → Page → Check`

Attach `Option` branches above or below the `Choice`. Use `Modal` as a short owned branch from the page that triggers it, then return to the triggering page or continue to an explicit destination. Use `Flow` connectors for the main path and short labels only on decision exits.

## Example composition: Sitemap

- Use `Page` nodes as the main vocabulary.
- Put one root at the top and domains in a single row beneath it.
- Use `Section` only when a domain contains several closely related pages.
- Use `Straight` connectors and consistent vertical levels.
- Limit the first view to two or three hierarchy levels; move deeper branches to a linked section.

## Example composition: User Persona

- Use one dominant persona identity area, not a dashboard of equal cards.
- Place one short `Quote` near the identity as the emotional anchor.
- Group goals, behaviors, and pain points into two or three open columns or shallow `Section` regions.
- Use `Label` for concise attributes and `Check` only for verified needs or outcomes.
- Use connectors only where a relationship must be explicit; proximity should carry most grouping.

## Example composition: Design Thinking

- Arrange phases in one reading direction: empathize, define, ideate, prototype, test.
- Use one `Section` per phase only when each contains multiple artifacts; otherwise use simple labeled stages.
- Use `Quote` for evidence, `Choice` for a decision gate, `Option` for candidate directions, and `Check` for validated outcomes.
- Use one restrained returning `Curve` connector to show iteration. Do not draw a web of feedback loops.

## Import mapping

When importing a `.fig` file or clipboard selection:

1. Keep the source example and primitives on a clearly named library or staging page.
2. Duplicate only the necessary example or components into the working flow.
3. Confirm text, fills, borders, frames, and connector endpoints remain native and editable.
4. Detach or restyle only where required by the product's actual tokens.
5. Remove unused imported examples from the working composition, but retain the reusable source library when the user wants continued access.
6. Never trace a flattened screenshot when native kit layers are available.

