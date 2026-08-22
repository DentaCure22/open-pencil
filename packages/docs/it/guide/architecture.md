# Architettura

## Panoramica del Sistema

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

## Layout dell'Editor

L'editor usa un layout compatto incentrato sul canvas:

- **Barra laterale (sinistra)** — Livelli, Chat, Risorse e Attività in una superficie mobile
- **Barra degli strumenti** — Controlli integrati per disegno, selezione, spazio di lavoro e utilità
- **Canvas** — Superficie CanvasKit infinita con zoom, panoramica e azioni contestuali
- **Cassetto mobile** — Controlli Livelli, Design e Code nelle viste strette

## Componenti

### Rendering (CanvasKit WASM)

Lo stesso motore di rendering di Figma. CanvasKit fornisce disegno 2D accelerato dalla GPU con forme vettoriali, formattazione del testo tramite Paragraph API, effetti (ombre, sfocature, modalità di fusione) ed esportazione (PNG, SVG). Il binario WASM da 7MB viene caricato all'avvio e crea una superficie GPU sul canvas HTML.

Il renderer è suddiviso in moduli specializzati in `packages/core/src/renderer/`: attraversamento della scena, overlay, riempimenti, bordi, forme, effetti, righelli, etichette e cursori remoti.

### Scene Graph

`Map<string, Node>` piatto indicizzato da stringhe GUID. Struttura ad albero tramite riferimenti `parentIndex`. Fornisce lookup O(1), attraversamento efficiente, hit testing e query per area rettangolare per la selezione con marquee.

Il grafo emette eventi tipizzati tramite nanoevents: `node:created`, `node:updated`, `node:deleted`, `node:reparented`, `node:reordered`. I sottosistemi si iscrivono a questi eventi invece del cablaggio manuale — l'editor li usa per l'invalidazione del render e la sincronizzazione delle istanze dei componenti con microtask batching, il sistema di collaborazione per la propagazione Yjs.

Consulta il [riferimento Scene Graph](/it/reference/scene-graph) per i dettagli interni.

### Motore di Layout (Yoga WASM)

Yoga di Meta fornisce il calcolo del layout CSS flexbox e grid tramite un [fork](https://github.com/open-pencil/yoga/tree/grid) con supporto CSS Grid. Un adattatore sottile mappa i nomi delle proprietà Figma agli equivalenti Yoga:

| Proprietà Figma | Equivalente Yoga |
|---|---|
| `stackMode: HORIZONTAL` | `flexDirection: row` |
| `stackMode: VERTICAL` | `flexDirection: column` |
| `stackSpacing` | `gap` |
| `stackPadding` | `padding` |
| `stackJustify` | `justifyContent` |
| `stackChildPrimaryGrow` | `flexGrow` |

### Formato File (Kiwi Binary)

Riutilizza il codec binario Kiwi di Figma con 194 definizioni di messaggio/enum/struct. Importazione: analizza l'header → decompressione Zstd → decodifica Kiwi → `NodeChange`[] → scene graph. L'esportazione inverte il processo con generazione di miniature.

Consulta il [riferimento Formato File](/it/reference/file-format) per i dettagli.

### AI e Strumenti

Gli strumenti sono definiti una sola volta in `packages/core/src/tools/`, suddivisi per dominio: read, create, modify, structure, variables, vector, analyze. Ogni strumento ha parametri tipizzati e una funzione `execute(figma, args)`. Gli adattatori li convertono per:

- **Attività agenti** — conversazioni Pi nella barra laterale e nelle schede del Board
- **Server MCP** — schema zod, trasporti stdio + HTTP
- **CLI** — disponibili tramite il comando `eval`

Il catalogo viene scoperto a runtime invece di essere documentato come numero fisso. Include query XPath (`query_nodes`), ispezione JSX (`get_jsx`, `diff_jsx`), descrizione semantica (`describe`) e verifica visiva (`export_image`).

### Annulla/Ripristina

Pattern a comandi inversi. Prima di applicare qualsiasi modifica, i campi interessati vengono salvati in uno snapshot. Lo snapshot diventa l'operazione inversa. Il batching raggruppa le modifiche rapide (come il trascinamento) in singole voci di annullamento.

### Appunti

Appunti bidirezionali compatibili con Figma. Codifica/decodifica binario Kiwi (stesso formato dei file .fig) tramite eventi nativi di copia/incolla del browser. Gestisce il ridimensionamento dei tracciati vettoriali, i figli delle istanze, il rilevamento dei set di componenti e l'applicazione degli override.

### Collaborazione P2P

Collaborazione peer-to-peer in tempo reale tramite Trystero (WebRTC) + Yjs CRDT. Nessun relay server — segnalazione tramite broker MQTT pubblici, STUN/TURN per l'attraversamento NAT. Il protocollo Awareness fornisce cursori live, selezioni e presenza. Persistenza locale tramite y-indexeddb.

### Bridge RPC CLI-App

L'RPC live tra CLI e applicazione è disabilitato per ora. La persistenza locale di Board e Trace usa l'autorità limitata sulla porta 7602 e non richiede MCP.

## Prossimi Passi

### Strumenti di Design per CI

La CLI headless supporta già `analyze colors/typography/spacing/clusters`. Prossimamente: integrazione con GitHub Actions per linting automatico del design e regressione visiva nelle PR.

### Prototipazione

Transizioni frame-to-frame, trigger di interazione (clic, hover, trascinamento), gestione degli overlay e modalità anteprima a schermo intero.

### Firma del Codice per Windows

I binari macOS sono firmati e autenticati dalla v0.6.0. La firma Windows Authenticode tramite Azure Code Signing è pianificata per rimuovere l'avviso SmartScreen.
