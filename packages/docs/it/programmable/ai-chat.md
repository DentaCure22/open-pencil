---
title: Chat attività
description: Attività di sviluppo Pi condivise tra barra laterale e schede del Board.
---

# Chat attività

Apri la scheda **CHATS** nella barra laterale sinistra per avviare o continuare un’attività. OpenPencil avvia Pi direttamente e conserva modello, livello di ragionamento, messaggi, strumenti e follow-up in una sola conversazione.

## Flusso

- **Nuova attività** avvia una conversazione Pi.
- **Invia follow-up** continua la conversazione selezionata.
- Le **schede del Board** e CHATS mostrano gli stessi thread locali.
- Gli **allegati** vengono caricati con il prompt.
- **Interrompi** termina il turno attivo.

Non esistono dispatcher o backend alternativi. L’elenco dei modelli proviene dal catalogo Pi.

## Attività e Trace

Ragionamento e chiamate agli strumenti mantengono l’ordine originale. Il lavoro attivo resta aperto; l’attività conclusa viene riassunta con la durata del turno.

Trace è separato dalla chat. L’ultimo gesto è in `~/.openpencil/local-workspace-authority-v1/trace-context.json`; gli estratti storici limitati sono in `trace-events/*.jsonl`.

## Automazione del design

I client MCP scoprono a runtime il catalogo attuale degli strumenti OpenPencil tramite stdio o HTTP. Vedi [Server MCP](./mcp-server).
