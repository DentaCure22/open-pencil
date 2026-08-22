# Architecture

## Vue d'ensemble du système

`mermaid
graph TB
    subgraph Tauri["Tauri v2 Shell"]
        subgraph Editor["Editor (Web)"]
            UI["Vue 3 UI<br/>Sidebar · Tool rail · Canvas<br/>Layers · Chats · Assets · Activity"]
            Skia["Skia CanvasKit (WASM, 7MB)<br/>Vector rendering · Text shaping<br/>Effects · Export"]
            subgraph Core["Core Engine (TS)"]
                SG[SceneGraph] --- Layout[Layout - Yoga]
                SG --- Selection
                Undo[Undo/Redo] --- Constraints
                Constraints --- HitTest[Hit Testing]
            end
            subgraph FileFormat["File Format Layer"]
                FigIO[".fig import/export"] --- Kiwi[Kiwi codec]
                Kiwi --- SVG[SVG export]
            end
        end
        MCP["MCP Server (stdio+HTTP)"]
        Collab["P2P Collab (Trystero + Yjs)"]
    end
`

## Disposition de l'éditeur

L'éditeur utilise une disposition compacte centrée sur le canevas :

- **Barre latérale (gauche)** — Calques, Chats, Ressources et Activité dans une surface flottante
- **Barre d'outils** — Contrôles intégrés de dessin, sélection, espace de travail et utilitaires
- **Canevas** — Surface CanvasKit infinie avec zoom, déplacement et actions contextuelles
- **Tiroir mobile** — Contrôles Calques, Design et Code sur les écrans étroits

## Composants

### Rendu (CanvasKit WASM)

Le même moteur de rendu que Figma. CanvasKit fournit un dessin 2D accéléré par GPU avec formes vectorielles, mise en forme du texte via Paragraph API, effets (ombres, flous, modes de fusion) et export (PNG, SVG). Le binaire WASM de 7 Mo se charge au démarrage et crée une surface GPU sur le canvas HTML.

Le renderer est découpé en modules spécialisés dans `packages/core/src/renderer/` : parcours de scène, overlays, remplissages, contours, formes, effets, règles, étiquettes et curseurs distants.

### Graphe de scène

`Map<string, Node>` plat indexé par des chaînes GUID. Structure en arbre via des références `parentIndex`. Fournit une recherche O(1), un parcours efficace, du hit testing et des requêtes par zone rectangulaire pour la sélection par marquise.

Le graphe émet des événements typés via nanoevents : `node:created`, `node:updated`, `node:deleted`, `node:reparented`, `node:reordered`. Les sous-systèmes s'y abonnent au lieu d'un câblage manuel — l'éditeur les utilise pour l'invalidation du rendu et la synchronisation d'instances de composants batchée par microtâche, le système de collaboration pour la propagation Yjs.

Voir la [Référence du graphe de scène](/reference/scene-graph) pour les détails internes.

### Moteur de layout (Yoga WASM)

Yoga de Meta fournit le calcul de layout CSS flexbox et grid via un [fork](https://github.com/open-pencil/yoga/tree/grid) avec support CSS Grid. Un adaptateur fin mappe les noms de propriétés Figma vers les équivalents Yoga :

| Propriété Figma | Équivalent Yoga |
|---|---|
| `stackMode: HORIZONTAL` | `flexDirection: row` |
| `stackMode: VERTICAL` | `flexDirection: column` |
| `stackSpacing` | `gap` |
| `stackPadding` | `padding` |
| `stackJustify` | `justifyContent` |
| `stackChildPrimaryGrow` | `flexGrow` |

### Format de fichier (Kiwi binaire)

Réutilise le codec binaire Kiwi de Figma avec 194 définitions de message/enum/struct. Import : analyser l'en-tête → décompresser Zstd → décoder Kiwi → `NodeChange`[] → graphe de scène. L'export inverse le processus avec génération de miniature.

Voir la [Référence du format de fichier](/reference/file-format) pour plus de détails.

### IA et outils

Les outils sont définis une seule fois dans `packages/core/src/tools/`, découpés par domaine : read, create, modify, structure, variables, vector, analyze. Chaque outil a des paramètres typés et une fonction `execute(figma, args)`. Les adaptateurs les convertissent pour :

- **Tâches d'agents** — conversations Pi dans la barre latérale et les cartes du Board
- **Serveur MCP** — schémas zod, transports stdio + HTTP
- **CLI** — accessible via la commande `eval`

Le catalogue est découvert à l'exécution plutôt que documenté avec un nombre fixe. Il comprend la requête XPath (`query_nodes`), l'inspection JSX (`get_jsx`, `diff_jsx`), la description sémantique (`describe`) et la vérification visuelle (`export_image`).

### Annuler/Rétablir

Patron de commande inverse. Avant d'appliquer tout changement, les champs concernés sont capturés en snapshot. Le snapshot devient l'opération inverse. Le batching regroupe les changements rapides (comme le glissement) en entrées d'annulation uniques.

### Presse-papiers

Presse-papiers bidirectionnel compatible Figma. Encode/décode le binaire Kiwi (même format que les fichiers .fig) via les événements natifs copier/coller du navigateur. Gère le redimensionnement des chemins vectoriels, les enfants d'instances, la détection des ensembles de composants et l'application des surcharges.

### Collaboration P2P

Collaboration peer-to-peer en temps réel via Trystero (WebRTC) + Yjs CRDT. Sans serveur relais — signalisation via des brokers MQTT publics, STUN/TURN pour le traversal NAT. Le protocole d'awareness fournit des curseurs en direct, des sélections et de la présence. Persistance locale via y-indexeddb.

### Pont RPC CLI-vers-application

Le RPC direct entre le CLI et l'application est désactivé pour l'instant. La persistance locale du Board et de Trace utilise l'autorité limitée sur le port 7602 et ne nécessite pas MCP.

## Prochaines étapes

### Outillage de design pour la CI

Le CLI headless supporte déjà `analyze colors/typography/spacing/clusters`. Prochaine étape : intégration GitHub Actions pour le linting de design automatisé et la régression visuelle dans les PRs.

### Prototypage

Transitions frame-à-frame, déclencheurs d'interaction (clic, survol, glissement), gestion des overlays et mode aperçu plein écran.

### Signature de code Windows

Les binaires macOS sont signés et notarisés depuis la v0.6.0. La signature Authenticode Windows via Azure Code Signing est prévue pour supprimer l'avertissement SmartScreen.
