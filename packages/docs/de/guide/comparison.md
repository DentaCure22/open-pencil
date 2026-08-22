# Vergleich mit Penpot

OpenPencil und Penpot sind beides Open-Source-Design-Tools, aber sie unterscheiden sich grundlegend in Architektur, Rendering und Dateiformaten.

## 1. Auf einen Blick

| Metrik | Open Pencil | Penpot |
|--------|-------------|--------|
| Total LOC | **~26.000** | **~299.000** |
| Quelldateien | ~143 | ~2.900 |
| Sprachen | TypeScript, Vue | Clojure, ClojureScript, Rust, JS, SQL, SCSS |
| Rendering-Engine | ~3.200 LOC (TS, 10 Dateien) | 22.000 LOC (Rust/Skia WASM) |
| UI-Code | ~4.500 LOC | ~175.000 LOC (CLJS + SCSS) |
| Backend | Keines (local-first) | 32.600 LOC + 151 SQL-Dateien |
| LOC-Verhältnis | **1×** | **~11×** |

Open Pencil ist **~11× kleiner** — und das ist der Punkt. Es ist keine Vereinfachung; es ist eine grundlegend andere Architektur.

## 2. Architektur

| Aspekt | Open Pencil | Penpot |
|--------|-------------|--------|
| Rendering | Skia CanvasKit (GPU, WASM) | Skia Rust/WASM (render-wasm v1) |
| Layout | Yoga WASM (CSS-Flexbox) | Eigene CLJS-Engine |
| Dateiformat | Figmas Kiwi-Binär (.fig) | Eigenes SVG + penpot-Metadaten |
| Desktop | Tauri v2 (~5 MB) | Kein nativer Client |
| Backend | Keines (P2P) | Clojure + PostgreSQL + Redis |
| Hosting | Läuft lokal, kein Server nötig | Erfordert Docker-Stack |

## 3. Rendering

Open Pencil und Penpot verwenden beide Skia für das Rendering, aber die Implementierungen unterscheiden sich:

- **Open Pencil**: CanvasKit WASM — bewährt, GPU-beschleunigt, dieselbe Engine wie Figma
- **Penpot**: Eigener Rust/Skia-WASM-Renderer (render-wasm), ersetzt den früheren SVG-Renderer

## 4. Dateiformat

| | Open Pencil | Penpot |
|---|-------------|--------|
| Native-Format | .fig (Kiwi-Binär) | .penpot (SVG + Metadaten) |
| Figma-Import | Nativ | Plugin/Konverter |
| Figma-Export | Nativ | Nicht unterstützt |
| Figma-Zwischenablage | Bidirektional | Nicht unterstützt |
| Dateigröße | Kompakt (Zstd-komprimiert) | Größer (SVG-Text + JSON) |

## 5. Layout

| | Open Pencil | Penpot |
|---|-------------|--------|
| Engine | Yoga WASM (CSS-Flexbox) | Eigene CLJS-Implementierung |
| CSS Grid | Nicht unterstützt | Unterstützt |
| Flexbox | Vollständig (via Yoga) | Eigene Implementierung |
| Korrektheit | Yoga wird auf Milliarden von Geräten getestet | Eigene Testmatrix |

## 6. Kollaboration

| | Open Pencil | Penpot |
|---|-------------|--------|
| Modell | P2P (Trystero + Yjs CRDT) | Client-Server |
| Cursor | ✅ Echtzeit | ✅ Echtzeit |
| Offline | Vollständig offline-fähig | Erfordert Server |
| Self-Hosting | Nicht nötig (P2P) | Docker-basiertes Self-Hosting |

## 7. Entwicklererlebnis

| | Open Pencil | Penpot |
|---|-------------|--------|
| Beitragsumfang | ~143 TS-Dateien | 2.900+ Dateien, 4 Sprachen |
| Build-System | Vite + Bun (Sekunden) | Shadow-CLJS + Docker (Minuten) |
| Typensicherheit | TypeScript durchgängig | Clojure (dynamisch typisiert) |
| Tests | Playwright + bun:test | Clojure-Test + Cypress |
| Desktop-Build | `bun run tauri build` | Kein nativer Client |

## 8. Programmierbarkeit

| | Open Pencil | Penpot |
|---|-------------|--------|
| CLI | ✅ Headless .fig-Operationen | ❌ Kein CLI |
| AI-Werkzeuge | Pi-Aufgaben-Chat + MCP-Server | Plugin-System |
| JSX-Renderer | ✅ Programmgesteuerte Erstellung | ❌ |
| Eval-Befehl | ✅ Figma Plugin API | ❌ |
| Plugin-System | Über eval/MCP | ✅ Natives Plugin-System |

## 9. Desktop

| | Open Pencil | Penpot |
|---|-------------|--------|
| Native App | ✅ Tauri v2 (~5 MB) | ❌ |
| Offline | ✅ Vollständig | Erfordert Server |
| System-Schriften | ✅ Vollständig | Nur hochgeladene |
| Autosave | ✅ | Server-seitig |
| Native Menüs | ✅ macOS/Windows/Linux | N/A |

## 10. KI-Integration

| | Open Pencil | Penpot |
|---|-------------|--------|
| Integrierter Chat | ✅ OpenRouter-Integration | ❌ |
| Werkzeugnutzung | Zur Laufzeit entdeckter Design-Katalog | ❌ |
| MCP-Server | ✅ stdio + HTTP | ❌ |
| Bring your own key | ✅ Kein Vendor-Lock-in | ❌ |

## 11. Skripting & Erweiterbarkeit

| | Open Pencil | Penpot |
|---|-------------|--------|
| Headless CLI | ✅ 12 Befehle | ❌ |
| Plugin API | Figma-kompatibel | Eigene Plugin API |
| MCP-Server | ✅ stdio + HTTP | ❌ |
| Eval-Befehl | ✅ JS-Ausführung | ❌ |
| JSX-Renderer | ✅ Programmatisch | ❌ |

## Zusammenfassung

| Stärke | Gewinner | Grund |
|--------|----------|-------|
| **Figma-Kompatibilität** | Open Pencil | Natives .fig + Zwischenablage |
| **Programmierbarkeit** | Open Pencil | CLI, eval, JSX, MCP-Server |
| **Desktop-Erlebnis** | Open Pencil | Native Tauri-App, ~5 MB |
| **KI-Integration** | Open Pencil | Pi-Aufgaben-Chat und MCP |
| **Codebasis-Einfachheit** | Open Pencil | 11× weniger Code, 1 Sprache |
| **CSS Grid** | Penpot | Yoga unterstützt es noch nicht |
| **SVG-native** | Penpot | SVG ist die Muttersprache |
| **Self-Hosting** | Penpot | Docker-bereit vs. Desktop-only |
| **Ökosystem-Reife** | Penpot | Jahre der Produktion vs. frühe Phase |

Open Pencil ist architektonisch schlanker — ein Single-Process-CanvasKit-Renderer in TypeScript, Figma-kompatibel by Design. Penpot ist eine Full-Stack-Plattform über Clojure, ClojureScript, Rust und SCSS, plus eine Docker-Service-Flotte. Beide bieten Echtzeit-Kollaboration mit unterschiedlichen Architekturen. Penpot hat ein Plugin-Ökosystem und serverseitigen PDF-Export; Open Pencil hat Figma-kompatibles Headless-Scripting, Pi-Aufgaben-Chat, einen zur Laufzeit entdeckten MCP-Katalog, SVG-Export und eine native Desktop-App.
