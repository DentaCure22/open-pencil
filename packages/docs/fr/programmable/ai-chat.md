---
title: Chat de tâches
description: Tâches de développement Pi partagées entre la barre latérale et les cartes du Board.
---

# Chat de tâches

Ouvrez l’onglet **CHATS** de la barre latérale gauche pour démarrer ou poursuivre une tâche. OpenPencil lance Pi directement et conserve le modèle, l’effort, les messages, l’activité des outils et les suivis dans une seule conversation.

## Fonctionnement

- **Nouvelle tâche** démarre une conversation Pi.
- **Envoyer un suivi** poursuit la conversation sélectionnée.
- Les **cartes du Board** et CHATS affichent les mêmes threads locaux.
- Les **pièces jointes** sont envoyées avec le prompt.
- **Arrêter** termine le tour actif.

Il n’y a ni dispatcher ni backend alternatif. La liste des modèles vient du catalogue Pi.

## Activité et Trace

Le raisonnement et les appels d’outils gardent leur ordre d’origine. Le travail actif reste ouvert ; l’activité terminée est résumée avec la durée du tour.

Trace est séparé du chat. Le dernier geste se trouve dans `~/.openpencil/local-workspace-authority-v1/trace-context.json` ; les extraits historiques bornés sont dans `trace-events/*.jsonl`.

## Automatisation du design

Les clients MCP découvrent le catalogue actuel d’outils OpenPencil à l’exécution via stdio ou HTTP. Voir [Serveur MCP](./mcp-server).
