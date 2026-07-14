# Evaluation scenarios

Keep scenario IDs fixed so runs remain comparable.

## Train

- `train-flow-01`: Four-state clinical workflow with one error state and two alternate designs.
- `train-compare-01`: Production settings screen compared with compact and guided variants.
- `train-knowledge-01`: Research brief, linked records, and two application captures.
- `train-review-01`: Preferred design, reviewer comments, risks, and change-set readiness.
- `train-atlas-01`: Eight discovered application states grouped by route and confidence.

## Validation

- `val-onboarding-01`: Six-state onboarding journey with one branch and a focused activation view.
- `val-operations-01`: Operations workspace with a document view, board view, and linked incident records.

## Held-out test

- `test-billing-01`: Billing and subscription workflow with production, upgrade, failure, and recovery states.
- `test-inventory-01`: Inventory editing flow with desktop and narrow viewport alternatives plus approval.

## Required artifacts per scenario

- design brief
- chosen references and extracted grammar
- scene or view plan
- overview screenshot
- detail screenshot
- rubric score with feedback
- revision log
- final score

The Dental Chart canvas is a baseline application example, not a held-out test scenario.

## Regression fixtures

- `regression-dental-generic-01`: The rejected Dental Chart board documented in `negative-examples.md`. A candidate fails regression if it still relies on miniature fake screens, repeated pale cards, text-only variant differences, or a self-awarded passing score.
- `regression-capture-first-01`: A real route capture exists. The candidate must use it as the dominant visual anchor before creating any illustrative branch or comparison.
