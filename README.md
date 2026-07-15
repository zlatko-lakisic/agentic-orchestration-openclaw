# OpenClaw ↔ Agentic Orchestration Plugin

![Agentic Orchestration Plugin for OpenClaw](assets/hero.png)

Routes OpenClaw agent turns through [agentic-orchestration](https://github.com/zlatko-lakisic/agentic-orchestration) instead of OpenClaw’s native LLM call.

**By default the plugin installs and starts the backend for you** (managed sidecar).

## Requirements

- Node.js **22.19+**
- `git` and **Python 3.12+** (for first-time backend bootstrap — `python3.12` must be on PATH)
- OpenClaw gateway **≥ 2026.3.24-beta.2**
- For default local inference: [Ollama](https://ollama.com) with a model such as `llama3.2`  
  — or OpenAI / Anthropic credentials already configured in OpenClaw / the environment

## Install

```bash
cd /path/to/agentic-orchestration-openclaw
npm install && npm run build

openclaw plugins install file:/path/to/agentic-orchestration-openclaw
```

From ClawHub / GitHub (when published):

```bash
openclaw plugins install clawhub:zlatko-lakisic/agentic-orchestration
# or
openclaw plugins install github:zlatko-lakisic/agentic-orchestration-openclaw
```

> **Note:** The managed backend requires `agentic-orchestration-web` to expose
> `/api/v1/orchestrate`. When that route is missing from the cloned checkout,
> the plugin **injects it automatically** from `patches/` during bootstrap
> (`managedBackend: true`). Prefer a local checkout that already includes the
> endpoint (see `preferLocalCheckout` / `AGENTIC_ORCHESTRATION_ROOT`).

## OpenClaw config

```json
{
  "plugins": {
    "entries": {
      "agentic-orchestration": {
        "config": {
          "managedBackend": true,
          "timeoutMs": 120000,
          "runMode": "dynamic",
          "sessionPassthrough": true,
          "fallbackOnError": false
        },
        "hooks": {
          "allowConversationAccess": true
        }
      }
    }
  }
}
```

Optional: set `"apiKey": "your-secret-token"` in that `config` object and the same value as `AGENTIC_ORCHESTRATE_API_KEY` on the web server.

**`allowConversationAccess: true` is mandatory.**

Then restart the gateway:

```bash
openclaw gateway restart
```

Verify the plugin loaded and the hook is registered:

```bash
openclaw plugins inspect agentic-orchestration --runtime --json
```

Expected: output shows the plugin is active. If the backend is still bootstrapping, wait until the gateway log prints that the managed backend is ready before testing.

On service start the plugin will:

1. Prefer a **local checkout** of `agentic-orchestration` if found (`AGENTIC_ORCHESTRATION_ROOT`, then sibling dirs)
2. Otherwise **git clone** into `<openclaw-state>/agentic-orchestration/repo`
3. Inject `/api/v1/orchestrate` into `server.mjs` if upstream does not have it yet
4. Create a Python 3.12+ venv + `pip install -r requirements.txt`
5. `npm install` in `agentic-orchestration-web`
6. Map credentials: OpenClaw / env OpenAI·Anthropic keys if available, else **Ollama defaults**
7. Spawn `node server.mjs` and wait for `/api/ping`

## Manual / external backend

```json
{
  "managedBackend": false,
  "endpoint": "http://127.0.0.1:3847/api/v1/orchestrate"
}
```

Then run `agentic-orchestration-web` yourself (must expose `/api/v1/orchestrate`).

## Config reference

| Key | Default | Description |
|---|---|---|
| `managedBackend` | `true` | Auto install + start sidecar |
| `repoUrl` | `https://github.com/zlatko-lakisic/agentic-orchestration` | Clone source when no local checkout |
| `installDir` | `<state>/agentic-orchestration` | Sidecar root override |
| `preferLocalCheckout` | `true` | If `AGENTIC_ORCHESTRATION_ROOT` is set, use it. Otherwise look for `../agentic-orchestration` relative to the plugin directory (also checks `~/Projects/agentic-orchestration`). |
| `autoUpdate` | `true` | `git fetch/reset` on start (cloned only) |
| `backendHost` / `backendPort` | `127.0.0.1` / `3847` | Managed server bind |
| `bootstrapTimeoutMs` | `600000` | Clone + deps + health wait |
| `endpoint` | managed URL | Used when `managedBackend=false` |
| `apiKey` | *(none)* | Bearer for `/api/v1/orchestrate` |
| `timeoutMs` | `120000` | Per-request HTTP budget |
| `runMode` | `dynamic` | `dynamic` \| `dynamic-iterative` |
| `sessionPassthrough` | `true` | Forward OpenClaw session ID |
| `fallbackOnError` | `false` | Fall through to native LLM on failure |
| `verboseCrew` | `false` | CrewAI verbose |

> **First-run bootstrap** (clone + venv + pip install + npm install) typically takes
> **3–10 minutes** depending on network speed. The gateway log will show progress.
> Do not kill the process — wait for the managed backend ready message in the logs
> (e.g. `Managed backend ready at …`).

## How it works

1. OpenClaw loads the plugin and starts the `agentic-orchestration-backend` service.
2. Sidecar prepares the repo + deps and listens on `:3847`.
3. `before_agent_reply` POSTs `{ text, sessionId, … }` to `/api/v1/orchestrate`.
4. Hook returns `{ handled: true, reply: { text } }` — OpenClaw skips its own model call.

> OpenClaw **≥ 2026.7** `before_agent_reply` uses `{ handled: boolean, reply?: { text } }`
> (not a flat `{ reply: string }`). Returning without `handled: true` lets the native LLM run.

### Session continuity

With `sessionPassthrough: true`, OpenClaw’s `sessionKey` is sent as `sessionId`. On `/reset`, `before_reset` marks the next turn with `resetSession: true`.

## Develop

```bash
npm install
npm run build
npm test
```

## Publish to ClawHub

```bash
npm run build
clawhub package publish zlatko-lakisic/agentic-orchestration --dry-run
clawhub package publish zlatko-lakisic/agentic-orchestration
```

## Pitfalls

| Symptom | Fix |
|---|---|
| Hook never fires | Set `hooks.allowConversationAccess: true` |
| Backend not ready | Check gateway logs; first bootstrap can take several minutes |
| Ollama planner fails | `ollama pull llama3.2` (or set OpenAI/Anthropic keys) |
| Want external server only | `managedBackend: false` |
| Python venv fails | Install Python **3.12+** (`python3.12` on PATH) |

## License

Apache-2.0
