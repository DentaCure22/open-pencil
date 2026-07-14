# Live App Edit Workspaces

Status: implementation baseline  
Scope: Open Pencil canvas, live application pages, container editing, variants, flows, review, and promotion

## Product statement

Open Pencil is a spatial workspace around the real live application. A user can branch a page or container, edit it safely, preserve alternatives, connect states into flows, review the work, and deliberately promote an approved change back to the application.

The live application remains the source of truth. Ordinary canvas edits never silently overwrite it.

## Information model

The project tree has four top-level concepts:

- **Pages** contain canonical application screens and routes.
- **Assets** contain reusable components, patterns, icons, tokens, and templates.
- **Workspaces** contain drafts, variants, flows, notes, reviews, and archived explorations.
- **Change Sets** contain proposed, approved, implementing, and applied product changes.

The canvas and folder tree serve different purposes. Folders express ownership and durable structure. Canvas position expresses thinking, comparison, and progress. Moving an object on the canvas does not silently change its status or folder.

## Canvas organization

A workspace canvas can expose these collapsible zones:

1. **Production** — linked, read-only source frames.
2. **Exploring** — drafts and early alternatives.
3. **Flows** — connected pages and interaction states.
4. **Review** — proposals and pinned feedback.
5. **Approved** — accepted work ready for a change set.
6. **Archived** — preserved but inactive directions.

Canvas objects include live frames, editable branches, variant stacks, flow states, intent notes, review markers, and change-set summaries. Every branch retains a link to its source page, source container, and source version.

## Object lifecycle

```text
Production reference
  -> Draft
  -> Variant or Flow
  -> In review
  -> Preferred
  -> Change set
  -> Approved
  -> Implementing
  -> Verified
  -> Applied
  -> Historical record
```

`Preferred` is a design decision, not permission to update production. Production changes only through an explicitly approved and verified change set.

## Container header

The selected container header is the fast-action surface for the current container state.

```text
Patient Header  [Draft - Unsaved]     Undo  Compare  Save Draft  More
```

The minimum persistent controls are:

- **Undo** — reverse the latest edit in the current workspace.
- **Compare** — compare the selected state with production or another related variant.
- **Save / Save Draft** — preserve the current draft.
- **More** — organization and destructive actions.

The Save menu contains meaning-changing actions:

- **Save Draft** — update the current working version.
- **Save as Variant** — preserve the state as a named alternative.
- **Add to Flow** — add the state to a connected experience.
- **Create Change Set** — package approved work for implementation.

The More menu contains lower-frequency actions:

- Duplicate
- Branch from Here
- Move to Workspace
- Promote to Asset
- Copy or Export
- Reset Container
- Archive
- Delete

### Header states

| State | Status label | Primary action | Supporting actions |
| --- | --- | --- | --- |
| Production | Production | Branch to Edit | Compare, More |
| New branch | Draft - Unsaved | Save Draft | Undo, Reset |
| Saved draft | Draft - Saved | Save | Undo, Compare, More |
| Variant | Variant name - Saved/Unsaved | Save | Undo, Compare, More |
| In review | In Review | View Review | Compare, More |
| Approved | Approved | Create Change Set | Compare, More |
| In change set | Approved - CS-number | View Change Set | Compare, More |

Production is protected: it presents **Branch to Edit**, never an ordinary Save button.

## Core flows

### Safe edit

```text
Open live page
  -> Select container
  -> Branch to Edit
  -> Make immediate token-aware edits
  -> Save Draft, Reset, or Save as Variant
```

Edits persist through selection changes. Leaving with unsaved changes produces a warning. Reset can operate on a property, selected container, or entire draft.

### Preserve an alternative

```text
Select production, draft, or variant
  -> Branch from Here / Save as Variant
  -> Name the option
  -> Edit independently
  -> Compare
  -> Mark Preferred, Review, or Archive
```

Alternatives remain visible as a stack on the canvas and under `Workspaces/<workspace>/Variants` in the tree.

### Build a flow

```text
Create Flow
  -> Add linked production pages
  -> Branch editable states
  -> Connect triggers and outcomes
  -> Add loading, empty, error, and success states
  -> Preview journey
  -> Review
```

An interaction state belongs to its flow unless it becomes a canonical page or reusable asset.

### Review

```text
Send to Review
  -> Compare with production
  -> Pin feedback to objects
  -> Approve, request changes, or reject
  -> Resolve comments
  -> Resubmit when necessary
```

Review status is explicit. Moving a frame into the Review canvas zone does not itself submit it.

### Promote reusable work

```text
Select stable container design
  -> Promote to Asset
  -> Define name, properties, and supported variants
  -> Preview affected pages
  -> Create asset change set
```

Editing a component instance offers **Edit Local** and **Edit Source Asset**. Source-asset editing reports every affected page before approval.

### Apply to the application

```text
Preferred approved proposal
  -> Create Change Set
  -> Resolve affected pages, assets, tokens, and source targets
  -> Approve
  -> Implement
  -> Compare implementation with proposal
  -> Verify in the live app
  -> Apply
```

Applying creates a permanent history entry on affected pages and assets. Drafts, rejected alternatives, review comments, and the applied change set remain available as decision history.

### Source drift and conflicts

If production changes while a draft is open, offer:

- **Rebase** — reconcile the draft with current production.
- **Keep Isolated** — continue from the recorded source version.
- **Duplicate and Rebase** — preserve the old branch and create an updated one.

When change sets overlap the same source target, surface the conflict and require an explicit decision to choose, combine, or sequence the work.

## Persistence requirements

Each saved object records:

- Stable ID and object type
- Workspace and folder location
- Source page, container, and source version
- Parent branch or variant
- Original and edited property values
- Canvas position and grouping
- Status and review state
- Intent, notes, and comments
- Creator and timestamps
- Related flow and change-set IDs

Selection changes, canvas mode changes, and preview mode must not erase saved or unsaved edits.

## First implementation slice

The first slice validates the container-header model before deeper persistence work:

1. Render explicit Production, Draft, Variant, Review, and Approved states.
2. Protect Production behind **Branch to Edit**.
3. Provide **Save Draft**, **Save as Variant**, **Add to Flow**, and **Create Change Set**.
4. Keep Undo, Compare, Reset, and More actions visible according to state.
5. Show a readable event log so every action and state transition can be evaluated.

## Later implementation slices

1. Persist drafts and restore them across sessions.
2. Create linked branches and variant stacks on the real canvas.
3. Add folder-tree integration for Workspaces and Change Sets.
4. Add visual/token diffs and Compare mode.
5. Add flow connections and interaction states.
6. Add comments, review transitions, and approvals.
7. Generate implementation-ready change sets with source targets.
8. Verify and apply changes through the production integration.
