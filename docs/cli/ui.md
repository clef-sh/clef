# clef ui

Start the Clef local web UI server and open it in your default browser.

## Syntax

```bash
clef ui [options]
```

## Description

`clef ui` starts a local HTTP server bound to `127.0.0.1` only — never accessible from the network. Decrypted values are transmitted between server and browser, so the connection must be local-only.

The UI provides four main views:

- **Matrix view** — overview of all namespaces and environments with health status
- **Namespace editor** — view and edit secrets with masked values, environment tabs, and commit flow
- **Diff view** — side-by-side comparison of two environments
- **Lint view** — full repo validation with grouped issues and fix commands

The server runs until you press `Ctrl+C` in the terminal.

## Flags

| Flag            | Type      | Default | Description                                                  |
| --------------- | --------- | ------- | ------------------------------------------------------------ |
| `--port <port>` | `number`  | `7777`  | Port number to serve the UI on. Must be between 1 and 65535. |
| `--no-open`     | `boolean` | `false` | Do not automatically open the browser when the server starts |

## Examples

### Basic usage

```bash
clef ui
```

```
Clef UI running at http://127.0.0.1:7777 — press Ctrl+C to stop
```

Your default browser opens to `http://127.0.0.1:7777`.

### Custom port

```bash
clef ui --port 9000
```

```
Clef UI running at http://127.0.0.1:9000 — press Ctrl+C to stop
```

### Without auto-opening the browser

```bash
clef ui --no-open
```

```
Clef UI running at http://127.0.0.1:7777 — press Ctrl+C to stop
```

Navigate to `http://127.0.0.1:7777` manually.

### Graceful shutdown

Press `Ctrl+C` to stop the server:

```
^C
Shutting down Clef UI...
```

## Security

The server binds exclusively to `127.0.0.1` — other devices on your network cannot reach it and decrypted values never leave your machine. To access from another machine (not recommended), use SSH port forwarding:

```bash
ssh -L 7777:127.0.0.1:7777 user@remote-host
```

## API

Internal REST API at the same address (not intended for direct use):

| Endpoint                    | Method | Description                           |
| --------------------------- | ------ | ------------------------------------- |
| `/api/manifest`             | GET    | Returns the parsed manifest           |
| `/api/matrix`               | GET    | Returns the matrix status             |
| `/api/namespace/:ns/:env`   | GET    | Returns decrypted values for a cell   |
| `/api/namespace/:ns/:env`   | PUT    | Updates values in a cell              |
| `/api/diff/:ns/:envA/:envB` | GET    | Returns diff between two environments |
| `/api/lint`                 | GET    | Returns lint results                  |

## Related commands

- [`clef lint`](/cli/lint) — the same validation available in the lint view
- [`clef diff`](/cli/diff) — CLI equivalent of the diff view
- [`clef set`](/cli/set) — CLI equivalent of editing in the UI
