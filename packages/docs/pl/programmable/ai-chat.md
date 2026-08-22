---
title: Czat zadań
description: Zadania programistyczne Pi współdzielone przez pasek boczny i karty Board.
---

# Czat zadań

Otwórz kartę **CHATS** w lewym pasku bocznym, aby rozpocząć lub kontynuować zadanie. OpenPencil uruchamia Pi bezpośrednio i przechowuje model, poziom rozumowania, wiadomości, aktywność narzędzi i dalsze polecenia w jednej rozmowie.

## Przebieg

- **Nowe zadanie** rozpoczyna rozmowę Pi.
- **Wyślij dalsze polecenie** kontynuuje wybraną rozmowę.
- **Karty Board** i CHATS pokazują te same lokalne wątki.
- **Załączniki** są przesyłane razem z poleceniem.
- **Zatrzymaj** kończy aktywną turę.

Nie ma dispatchera ani alternatywnego backendu. Lista modeli pochodzi z katalogu Pi.

## Aktywność i Trace

Rozumowanie i wywołania narzędzi zachowują pierwotną kolejność. Aktywna praca jest rozwinięta; zakończona aktywność jest zwijana do podsumowania z czasem trwania tury.

Trace jest oddzielony od czatu. Ostatni gest znajduje się w `~/.openpencil/local-workspace-authority-v1/trace-context.json`, a ograniczone wycinki historii w `trace-events/*.jsonl`.

## Automatyzacja projektu

Klienci MCP odkrywają aktualny katalog narzędzi OpenPencil w czasie działania przez stdio lub HTTP. Zobacz [Serwer MCP](./mcp-server).
