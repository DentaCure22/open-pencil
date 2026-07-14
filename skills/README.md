# OpenPencil skills

This directory is the canonical editable home for OpenPencil-specific Codex skills. It is ready to be source-controlled once this currently uncommitted workspace receives its first commit.

## Organization

- One folder per skill.
- `SKILL.md` contains routing, the core workflow, and completion requirements.
- `references/` contains detailed contracts that should only be loaded when relevant.
- `agents/openai.yaml` contains the user-facing skill name and default prompt.
- `evals/` contains representative scenarios used to verify routing and safety.

Installed copies may live under `~/.codex/skills`, but this workspace directory is the canonical editable source. Synchronize an installed copy only after validating the source package.

Use the deterministic helper from the workspace root:

```sh
bash tools/skill-sync/sync_openpencil_skills.sh check
bash tools/skill-sync/sync_openpencil_skills.sh install
```

`check` never writes. `install` installs only missing packages and refuses to overwrite an installed copy that differs from canonical source.

## Current source packages

- `openpencil-knowledge-canvas` — general authoring across documents, diagrams, design artifacts, and safely embedded real application states.
- `openpencil-agent-bridge` — safe semantic control, live-container identity, and MCP/source boundaries.
- `openpencil-edit-versions` — isolated design branches, comparison, review, and promotion.
- `openpencil-flow-states` — guided journey boards with vertical edit branches.

All four packages now live in this canonical directory. Update them here first, validate, then synchronize installed projections; do not hand-edit both locations.
