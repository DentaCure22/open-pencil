# Open-source workspace Code Object attribution

This OpenPencil component adapts interaction patterns and source structure from:

- **OpenArchFlow** by Rafael Sales — MIT License  
  https://github.com/dmux/OpenArchFlow  
  Architecture canvas, node registry, connection styling, palette, and React Flow patterns were studied from `src/components/diagram/FlowCanvas.tsx` and adjacent node/edge components.

- **OpenSail** by TesslateAI — Apache License 2.0  
  https://github.com/TesslateAI/OpenSail  
  Project architecture, task model, Kanban drag/drop, toolbar, status, and project-shell patterns were studied from `app/src/components/views/ArchitectureView.tsx` and `app/src/components/panels/KanbanPanel.tsx`.

The adapter is integrated as an ordinary persisted OpenPencil Code Object. It does not embed either upstream application and does not include their backend services.
