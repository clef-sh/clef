# Web UI Overview

The Clef web UI is a local-only browser application that provides a visual interface for managing your encrypted secrets. It is launched with `clef ui` and served at `http://127.0.0.1:7777`.

## Launching the UI

```bash
clef ui
```

Your default browser opens automatically. The server runs until you press `Ctrl+C`. To use a custom port or suppress the browser launch:

```bash
clef ui --port 9000 --no-open
```

## Architecture

The UI is a React single-page application served by an Express.js server. The server communicates with the core library to decrypt, modify, and re-encrypt secrets. All SOPS operations happen on the server side — decrypted values travel only over the local loopback interface (`127.0.0.1`).

```
Browser (React)  ←→  Express server (127.0.0.1:7777)  ←→  SOPS binary
                          ↕
                     Core library
                     (ManifestParser, SopsClient, DiffEngine, etc.)
```

## Sidebar navigation

The left sidebar (220px wide) provides global navigation and contextual information:

### Header

- **Clef** logotype with the repository name and current git branch

### Primary navigation

- **Matrix** — the home screen showing the namespace-by-environment grid
- **Diff** — side-by-side environment comparison
- **Lint** — full repo validation report

### Namespace list

Each namespace is listed with a badge showing the count of open issues (if any). Clicking a namespace opens the editor for that namespace.

### Status footer

The footer is always visible at the bottom of the sidebar and shows:

- **Uncommitted files** — count of modified encrypted files not yet committed
- **Key backend** — which SOPS backend is configured (e.g., "age" with recipient count)

The footer ensures developers never have to hunt for whether their encryption key is loaded.

## Screens

The UI has four main screens, each corresponding to a core workflow:

| Screen                         | Purpose                                  | CLI equivalent         |
| ------------------------------ | ---------------------------------------- | ---------------------- |
| [Matrix View](/ui/matrix-view) | "Is my repo healthy?" at a glance        | `clef lint`            |
| [Namespace Editor](/ui/editor) | View and edit secrets for a namespace    | `clef get`, `clef set` |
| [Diff View](/ui/diff-view)     | Compare two environments                 | `clef diff`            |
| [Lint View](/ui/lint-view)     | Full validation report with fix commands | `clef lint`            |

## Colour conventions

Colours in the UI are semantic, not decorative:

| Colour | Hex       | Meaning                                              |
| ------ | --------- | ---------------------------------------------------- |
| Amber  | `#F0A500` | Active selection, dirty/edited state, primary action |
| Green  | `#22C55E` | Healthy, passing, confirmed                          |
| Red    | `#EF4444` | Error, missing, production environment               |
| Yellow | `#FBBF24` | Warning, staging environment                         |
| Blue   | `#60A5FA` | Info, type annotations, dev environment              |
| Purple | `#A78BFA` | SOPS-specific indicators                             |

Environment badges follow a fixed colour scheme throughout the UI: **DEV** in green, **STG** in amber, **PRD** in red. Production is always red — this is a safety decision, not a design preference.

## Security

The UI server binds exclusively to `127.0.0.1`. It will never accept connections from other machines on the network. Decrypted secret values exist in memory on the server and are transmitted to the browser only over the local loopback interface.

All values in the editor are masked by default (shown as bullet characters). This makes the UI safe for screen sharing — you must explicitly click the reveal button to see a value.
