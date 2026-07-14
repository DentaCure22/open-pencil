# Flowchart Evaluation Checklist

Evaluate the rendered chart after import/composition and again after revision. Capture both a fit-to-view overview and a readable detail view.

## Hard gates

Fail the chart immediately if any answer is `No`:

- Is the primary reading direction obvious without reading a paragraph?
- Are the main nodes and labels readable at the intended review zoom?
- Are the chart objects native and editable rather than a flattened image?
- Are spacing and alignment visibly consistent across repeated nodes?
- Are primary connectors directional, attached correctly, and mostly free of crossings?
- Is the chart free of unnecessary container-on-container nesting?
- If this maps a live application, is source-backed versus `Illustrative preview` status truthful?
- Was at least one visual revision made after screenshot inspection?

## Scored review

Score each category from 0 to 10.

| Category | A 9–10 result looks like |
| --- | --- |
| Reading order | The eye reaches start, primary path, decision, and outcome in the intended sequence immediately. |
| Hierarchy | The primary path dominates; branches, notes, and metadata are quieter but clear. |
| Spacing | Outer margins, node gaps, padding, and section gaps follow a consistent rhythm. |
| Alignment | Peer nodes share axes and baselines; labels appear optically centered. |
| Typography | Copy is concise, readable, and uses no more hierarchy levels than necessary. |
| Color | One accent and restrained semantic colors create meaning without visual noise. |
| Connectors | Routes are short, clear, attached, directional, and do not compete with nodes. |
| Container restraint | Grouping surfaces exist only for real phases or domains; the canvas remains open. |
| Template fidelity | Imported primitives retain the kit's disciplined proportions while fitting the user's content. |
| Task usefulness | The chart answers the stated question and makes the next action or decision clear. |

Passing score: `85/100`, with every hard gate passing.

## Screenshot comparison questions

- What receives attention first, and is it the intended start or focal path?
- Does any gap look accidental, compressed, or larger than its semantic importance?
- Does any node look off-center even if its numeric bounds are correct?
- Can one container, sentence, color, label, or connector be removed without losing meaning?
- Are secondary branches visibly subordinate without becoming illegible?
- Does the detail screenshot reveal clipped text, loose padding, weak connector anchors, or inconsistent radii?
- Did the revision solve a named visible problem rather than merely rearrange the board?

Record the lowest-scoring category, the visible reason, the revision made, and the new result. Do not use a numeric score to overrule an obvious screenshot defect or the user's visual rejection.

