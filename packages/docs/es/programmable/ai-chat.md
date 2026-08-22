---
title: Chat de tareas
description: Tareas de programación con Pi compartidas por la barra lateral y las tarjetas del Board.
---

# Chat de tareas

Abre la pestaña **CHATS** de la barra lateral izquierda para iniciar o continuar una tarea. OpenPencil ejecuta Pi directamente y conserva el modelo, el esfuerzo, los mensajes, la actividad de herramientas y los seguimientos en una sola conversación.

## Flujo

- **Nueva tarea** inicia una conversación Pi.
- **Enviar seguimiento** continúa la conversación seleccionada.
- Las **tarjetas del Board** y CHATS muestran los mismos hilos locales.
- Los **archivos adjuntos** se cargan con el prompt.
- **Detener** finaliza el turno activo.

No hay dispatcher ni un backend alternativo. La lista de modelos proviene del catálogo de Pi.

## Actividad y Trace

El razonamiento y las herramientas conservan su orden original. El trabajo activo permanece abierto; la actividad terminada se resume con la duración del turno.

Trace está separado del chat. El gesto más reciente está en `~/.openpencil/local-workspace-authority-v1/trace-context.json`; los fragmentos históricos acotados están en `trace-events/*.jsonl`.

## Automatización de diseño

Los clientes MCP descubren el catálogo actual de herramientas de OpenPencil en tiempo de ejecución mediante stdio o HTTP. Consulta [Servidor MCP](./mcp-server).
