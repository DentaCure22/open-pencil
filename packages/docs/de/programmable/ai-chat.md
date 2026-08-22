---
title: Aufgaben-Chat
description: Pi-gestützte Coding-Aufgaben in der Seitenleiste und auf Board-Karten.
---

# Aufgaben-Chat

Öffne den Tab **CHATS** in der linken Seitenleiste, um eine Aufgabe zu starten oder fortzusetzen. OpenPencil startet Pi direkt und speichert Modell, Aufwand, Nachrichten, Werkzeugaktivität und Folgefragen in einer gemeinsamen Konversation.

## Ablauf

- **Neue Aufgabe** startet eine neue Pi-Konversation.
- **Nachricht senden** setzt die ausgewählte Konversation fort.
- **Board-Karten** und die CHATS-Seitenleiste zeigen dieselben lokalen Threads.
- **Anhänge** werden zusammen mit dem Prompt hochgeladen.
- **Stoppen** beendet den aktiven Turn.

Es gibt keinen Dispatcher und kein alternatives Backend. Die Modellliste stammt aus dem Pi-Katalog.

## Aktivität und Trace

Reasoning und Werkzeugaufrufe bleiben in ihrer ursprünglichen Reihenfolge. Aktive Arbeit ist aufgeklappt; abgeschlossene Aktivität wird mit der Turn-Dauer kompakt zusammengefasst.

Trace ist vom Chat getrennt. Die letzte Geste steht in `~/.openpencil/local-workspace-authority-v1/trace-context.json`; begrenzte historische Ausschnitte liegen in `trace-events/*.jsonl`.

## Design-Automatisierung

MCP-kompatible Clients entdecken den aktuellen OpenPencil-Werkzeugkatalog zur Laufzeit über stdio oder HTTP. Siehe [MCP-Server](./mcp-server).
