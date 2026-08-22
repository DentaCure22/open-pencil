---
layout: doc
title: IA et automatisation
description: Chaque opération dans OpenPencil est scriptable — chat IA, CLI, moteur de rendu JSX, serveur MCP, collaboration en temps réel.
---

# IA et automatisation

OpenPencil traite les fichiers de design comme des données. Chaque opération disponible dans l'éditeur — créer des formes, définir des remplissages, gérer l'auto-layout, exporter des assets — est aussi disponible depuis le terminal, depuis des agents IA, et depuis du code. Pas de plugins à installer, pas de clés API, pas de liste d'attente.

L'interface de l'éditeur et les interfaces d'automatisation utilisent le même moteur. Si vous pouvez le faire en cliquant, vous pouvez le faire en scriptant.

## Chat de tâches

Le chat de tâches Pi conserve le travail de développement et les suivis dans une conversation. L'automatisation de l'éditeur est disponible via le catalogue MCP découvert à l'exécution.

[Chat de tâches →](./ai-chat)

## Collaboration

Édition multijoueur en temps réel via WebRTC pair-à-pair. Pas de serveur, pas de compte. Partagez un lien de salle et éditez ensemble avec des curseurs en direct et le mode suivi. L'état du document se synchronise via CRDT, donc les modifications fusionnent automatiquement même avec des connexions instables.

[Collaboration →](./collaboration)

## Moteur de rendu JSX

Décrivez une interface en JSX — la même syntaxe que les LLMs connaissent déjà grâce à React. Un seul appel peut créer un arbre de composants complet avec des frames, du texte, de l'auto-layout, des remplissages et des contours. Compact, déclaratif et diffable.

Dans l'autre sens, exportez n'importe quelle sélection en JSX avec des classes Tailwind — utile pour le transfert au développement ou pour renvoyer des designs dans un LLM.

[Moteur de rendu JSX →](./jsx-renderer)

## CLI

Inspectez, exportez et analysez des fichiers `.fig` sans ouvrir l'éditeur. Listez les pages, recherchez des nœuds, extrayez des tokens de design, rendez en PNG — le tout depuis le terminal avec une sortie JSON lisible par machine.

Le CLI se connecte aussi à l'application de bureau en cours d'exécution via RPC, ce qui permet de scripter l'éditeur pendant que vous l'utilisez.

[Inspecter des fichiers](./cli/inspecting) · [Exporter](./cli/exporting) · [Analyser des designs](./cli/analyzing) · [Scripter](./cli/scripting)

## Serveur MCP

Connectez Claude Code, Cursor, Windsurf ou tout client MCP à OpenPencil. Le serveur expose un catalogue découvert à l'exécution pour lire, créer et modifier des designs via stdio ou HTTP avec support de sessions.

[Serveur MCP →](./mcp-server)

## Pourquoi ouvert ?

Figma est une plateforme fermée. Leur serveur MCP est en lecture seule. L'accès via CDP au navigateur a été supprimé dans la version 126. Les fichiers de design sont stockés dans un format propriétaire sur les serveurs de quelqu'un d'autre. Le développement de plugins nécessite un runtime personnalisé avec des API limitées.

OpenPencil est l'alternative : open source, sous licence MIT, chaque opération scriptable, données stockées localement. Vos fichiers de design vous appartiennent — inspectez-les, transformez-les, intégrez-les dans votre CI, envoyez-les à un LLM. Aucune permission nécessaire.
