# Agent (Opencode) loop

This note explains **what happens after a user sends a message** in an Agent (Opencode) chat.

It is **not** Agent (beta), and it is **not** Cursor. The worker is **OpenCode**. Agent (beta) uses its own tables, cron, and folder (`shell/agent/`). Opencode uses its own path from start to finish.

See also: [agent-opencode-requirement.md](./agent-opencode-requirement.md) and [agent-opencode-loop.md](./agent-opencode-loop.md)

---

## 1. What this loop is

Chat has three answer engines:

1. **Concise** — answers in the same request.
2. **Agent (beta)** — long background loop with goals and tools.
3. **Agent (Opencode)** — save the request, then a cron job runs: **input → copy keys to OpenCode settings → call OpenCode → output**.

Sending a message does **not** call OpenCode. It only starts a pending run. Cron does the real work a few seconds later.

The worker command is `opencode run` inside Agent Workspace. OpenCode may create or edit files, then the chat bubble is replaced with the answer.

---

## 2. What the user does

### Step 1 — Pick the engine

1. Open **New chat** or thread settings.
2. Choose **Agent (Opencode)**.
3. Start the chat.

The thread stores `answerEngine: agentOpencode`. `executeShell` stays **false**.

### Step 2 — Set keys (once)

In **Settings → API Keys**, save at least one of:

1. OpenRouter
2. Groq
3. OpenAI
4. Ollama
5. LocalAI

Also keep **Agent Workspace** valid (URL + token). OpenCode runs inside that workspace.

### Step 3 — Send a message

1. Type a task (example: “Create hello.txt with Hello, world”).
2. Send.
3. The chat shows: `Agent (Opencode) started. Workspace will be initialized shortly.`
4. The page polls status until the run finishes or fails.

---

## 3. What send does (init only)

Code: `POST /api/chat-llm/agent-opencode/init` → `agentOpencodeInitiate`

### Step 1 — Find the last user message

The API loads the thread and the latest user message. If the thread is not Opencode, init stops.

### Step 2 — Stop older pending runs on this thread

If this thread already has a **pending** Opencode run, that old run is marked **failed** (“superseded”). Only the newest request should run.

### Step 3 — Insert a pending row

A row is created in collection `agentOpencodeInstance`:

| Field | Meaning |
| :--- | :--- |
| `status` | `pending` |
| `statusIsRunning` | `false` |
| `promptText` | the user message |
| `pipelineStep` | empty until cron starts |
| `chatMessageId` | the AI bubble that will be updated later |

### Step 4 — Show a chat bubble

An AI message is inserted with tag `agentOpencode` and the start text above. Cron will **replace** that text later. It does not add a second bubble.

Send is done. OpenCode has not run yet.

---

## 4. What cron does (the real loop)

Code: `agentOpencodeCronTick` in `srcCron/indexCron.ts`

1. Runs **every 5 seconds**.
2. `noOverlap: true` — a second tick will not start while one is still running.
3. Picks **one** row: `status = pending` and `statusIsRunning = false` (oldest first).
4. Sets `statusIsRunning = true` so no other tick takes the same row.
5. Calls the pipeline: input → settings → OpenCode → output.

If the pipeline throws, the row becomes `failed`, `statusIsRunning` goes back to `false`, and the chat bubble shows the error.

---

## 5. Pipeline overview

Code: `agentOpencodeRunPipeline`

Folder on Agent Workspace (not Agent-beta’s folder):

```
ai-notes-xyz-agent-workspace/shell/agent-opencode/{thread-id}/
  input/prompt-{instance-id}.md
  input/CHAT.md                 ← full thread transcript
  agent-workspace/              ← OpenCode works here (one session per thread)
    CHAT.md
    uploads/                    ← chat attachments
    opencode.json               ← keys copied from Settings
    .env
    .xdg-data/                  ← OpenCode session database (HOME is this folder)
  output/prompt-{instance-id}.md
```

Pipeline steps stored on the row: `input` → `settings` → `opencode` → `output` → `done`.

The UI shows the same label: **input → settings → opencode → output**.

---

## 6. Step A — Input

Code: `agentOpencodeStepInput`

1. Need a valid **Agent Workspace** URL and token (Settings, or env `AM4_SHELL_ENGINE_URL` / `SHELL_ENGINE_URL` plus token). If missing, the run fails.
2. Write the latest user prompt to `input/prompt-{id}.md`.
3. Copy chat attachments into `agent-workspace/uploads/` (same files as the thread, not Agent-beta’s folder).
4. Write the **full thread transcript** to `agent-workspace/CHAT.md` and `input/CHAT.md` (user + assistant turns, file paths, current message). Placeholder “started / settings / running” bubbles are skipped.
5. Ensure `agent-workspace/.gitkeep` exists so the folder exists.
6. Write the start message into `output/prompt-{id}.md` (placeholder until OpenCode finishes).

---

## 7. Step B — Copy env keys into OpenCode settings

Code: `agentOpencodeStepSettings`

Chat bubble becomes: `Agent (Opencode) started. Copying Groq / OpenRouter keys into OpenCode settings...`

The keys come from the same user document as Settings (`SchemaUserApiKey`). They are **not** a Cursor key.

### Step 1 — Read saved keys

From the user’s API-key row, take any that are valid:

1. Groq
2. OpenRouter
3. OpenAI
4. Ollama
5. LocalAI
6. Replicate / RunPod (env only, if set)

If none of Groq / OpenRouter / OpenAI / Ollama / LocalAI is set, the run fails.

### Step 2 — Pick one provider and write config

The pipeline prefers **OpenRouter**, then Groq, then OpenAI, then the first configured provider.

Only **that one** provider is written into `opencode.json`. Extra endpoints (for example a hanging Ollama URL) are not added, because they can stall OpenCode startup.

Into `agent-workspace/`:

1. `opencode.json` — model, permissions (`allow` for files/shell), the chosen provider key, and the remote MCP server (`search` / `add_chat_file`; see section 19)
2. `.env` — `OPENROUTER_API_KEY`, `GROQ_API_KEY`, and so on. No `WEBHOOK_TOKEN`. `CHAT_MESSAGE_ID` may be set; the MCP header is the source of truth for attach-file.

Permissions include `bash`, `edit`, `write`, `read`. `question` is denied so OpenCode does not wait for a human prompt.

---

## 8. Step C — Call OpenCode with the instruction

Code: `agentOpencodeStepCall`

Chat bubble becomes: `Agent (Opencode) started. Calling OpenCode with the instruction...`

### Step 1 — Run OpenCode in the workspace folder

On Agent Workspace, the API posts to `/api/shell-engine/run-shell/execute` with `treatStderrAsFailure: false` (OpenCode logs on stderr; that must not look like a failed command). Timeout is up to **5 minutes** (workspace max **10 minutes**).

The shell command:

1. `cd` into `shell/agent-opencode/{thread-id}/agent-workspace/`
2. Isolate OpenCode home under that folder (`HOME` / `XDG_*`) so one thread does not lock another
3. Load `.env`
4. Fake a TTY with `script -q -c '…' /dev/null` — without a TTY, `opencode run` hangs during plugin setup
5. Run:

```
opencode --pure run --auto --format json --model <provider/model> --dir "$WORKDIR" [--session <id>] [--title "AI Notes …"] "<instruction>"
```

Flags:

- `--pure` — skip external plugins
- `--auto` — approve file/shell tools that are not denied
- `--format json` — one JSON event per line (the last `text` event is the spoken answer)
- `--session` — continue this thread’s OpenCode session after the first run
- `--title` — name the session on the first run

The long chat history is written to `INSTRUCTION.md` and `CHAT.md`. The CLI only gets a short prompt (`Read INSTRUCTION.md…`) so OpenCode does not treat the transcript as a `--file` path.

The instruction tells OpenCode to use **relative paths**, complete the user task, write `ANSWER.md`, and print the same Markdown.

**Session per thread**

1. Each thread keeps one OpenCode session id (`ses_…`) on `chatLlmThread.opencodeSessionId` (also copied to the instance `opencodeRunId`).
2. The first run creates the session (`--title`) and attaches `CHAT.md` so the chat is in the session.
3. Later runs on the same thread pass `--session <id>` and only the new user message (the transcript stays in `CHAT.md` and in the session).
4. Session files live under `agent-workspace/.xdg-data/` because `HOME` is that folder.
5. If `--session` returns no answer, the pipeline retries once without a session and stores the new id.

### Step 2 — Take the answer

1. Prefer `ANSWER.md` if it exists.
2. Else parse JSON stdout for `type: "text"` parts.
3. If both are empty, the run fails.

---

## 9. Step D — Output

Code: `agentOpencodeStepOutput`

1. Write the answer into remote `output/prompt-{id}.md`.
2. Read that file again (it is the source of truth for chat).
3. Set the row:
   - `status` = `filesInitialized`
   - `pipelineStep` = `done`
   - `statusIsRunning` = `false`
4. Replace the chat bubble with the output file content.

The user now sees the answer in chat. Files OpenCode wrote live under `shell/agent-opencode/{thread-id}/agent-workspace/`.

---

## 10. How the UI stays in sync

1. After send, the client toasts that the workspace will start soon.
2. While the thread is Opencode, the client calls `POST /api/chat-llm/agent-opencode/status` on an interval.
3. If status is `pending`, it refreshes chat messages (the bubble text may change).
4. When status leaves `pending` (`filesInitialized` or `failed`), it refreshes once more so the user sees the final text.

Other status APIs:

- `POST /api/chat-llm/agent-opencode/instance-list`
- `POST /api/chat-llm/agent-opencode/instance-by-id`
- `POST /api/chat-llm/agent-opencode/open-session` — launch this thread’s OpenCode TUI on the virtual computer (webtop desktop)

**Open session button**

On the Agent (Opencode) panel, **Open session**:

1. Opens the virtual computer tab (same desktop as LibreOffice, typically `http://localhost:3010`).
2. Asks Agent Workspace to start `opencode --session <id> --dir agent-workspace` in a desktop terminal (`xfce4-terminal`).
3. The TUI uses the same `HOME` / session database as the cron runs.

Rebuild the Agent Workspace image after changing the open-session route. The API inside the container is compiled JS.

---

## 11. Failure path

If any pipeline step throws:

1. `status` = `failed`
2. `statusIsRunning` = `false`
3. `errorReason` = the error text
4. Chat bubble = `Agent (Opencode) failed.` plus that error

Common failures:

- Agent Workspace not configured
- No Groq / OpenRouter / OpenAI / Ollama / LocalAI key
- OpenCode binary missing on Agent Workspace
- OpenCode hung because execute had no TTY (fixed by wrapping with `script`)
- OpenCode returned empty output

---

## 12. Next message on the same thread

1. User sends another message.
2. Init creates a **new** pending row and a **new** AI bubble.
3. Any still-pending row on that thread is marked failed (superseded).
4. Cron runs the new row. The same thread folder is reused: `shell/agent-opencode/{thread-id}/`.
5. New prompt files use the new instance id: `prompt-{new-id}.md`.
6. Settings files are written again from the current API keys.
7. `CHAT.md` is rewritten with the full transcript, attachments are re-synced, and OpenCode continues the **same session** (`--session`).

---

## 13. Delete thread

When a chat thread is deleted:

1. All `agentOpencodeInstance` rows for that thread are removed.
2. The remote folder `shell/agent-opencode/{thread-id}/` is deleted if Agent Workspace is configured.

This does not touch Agent (beta) folders under `shell/agent/`.

---

## 14. Agent Workspace execute (needed for OpenCode)

File: `ai-notes-xyz-agent-workspace` → `POST /api/shell-engine/run-shell/execute`

Agent (beta) still treats a non-empty **stderr** as failure by default (`treatStderrAsFailure` defaults to true, 15s timeout).

Agent (Opencode) sends:

- `treatStderrAsFailure: false`
- `timeoutMs` up to 300000 (cap 600000)

Rebuild the Agent Workspace image after changing this route. The API inside the container is compiled JS, not a live TypeScript mount.

---

## 15. Tests (Agent Opencode, not Agent beta)

Runner (from `ai-notes-xyz-api`):

```
TS_NODE_TRANSPILE_ONLY=1 npx ts-node -r dotenv/config ./srcTest/agentOpencodeUseCases/run-task-opencode.ts <task-slug>
```

Do **not** use Agent-beta `run-task.ts`.

Five use cases checked:

| Slug | Result |
| :--- | :--- |
| `task-006-write-hello-world-file` | pass (`hello.txt`) |
| `task-008-copy-file-to-backup` | pass (`input.backup.txt`) |
| `task-014-sum-three-numbers` | pass (`sum.txt`) |
| `task-016-first-line-only` | pass (`first.txt`) |
| `task-135-draft-email-content` | pass (`kickoff-invite-draft.md`) |

Reports: `ai-notes-xyz-test-use-cases/2026-08-06-make-agent-better/use-cases-report/` with `engine: agentOpencode`.

Needs: Mongo user with valid Agent Workspace + at least one LLM key, and a running Agent Workspace container with `opencode` on PATH.

---

## 16. Isolation (do not mix with Agent beta)

1. Collection `agentOpencodeInstance` only — never `SchemaAgent*`.
2. Folder prefix `shell/agent-opencode/` only — never `shell/agent/`.
3. Cron `agentOpencodeCronTick` only.
4. Routes under `/api/chat-llm/agent-opencode/` (`/init`, `/status`, `/instance-list`, `/instance-by-id`, `/open-session`).
5. Worker is OpenCode, not Cursor SDK.

---

## 17. One-page picture

```
User sends message
        │
        ▼
POST /agent-opencode/init
  • pending row in agentOpencodeInstance
  • AI bubble: “started…”
        │
        ▼
Cron every 5s (no overlap)
  lock one pending row
        │
        ▼
  input      write input/prompt-{id}.md
        │
        ▼
  settings   copy Groq / OpenRouter / … into
             agent-workspace/opencode.json and .env
        │
        ▼
  opencode   script -q -c 'opencode --pure run --auto …'
        │
        ▼
  output     write output/prompt-{id}.md
             update the same AI bubble
        │
        ▼
status = filesInitialized  (or failed)
```

---

## 18. User webhooks (`/api/webhook/*`)

HTTP search and attach-file remain available for non-OpenCode callers. This does not use cookie or device login. There are no webhook routes to create or update notes or tasks. **Agent (Opencode) does not use these routes** — it calls MCP tools instead (section 19).

### Token

1. Each user has one alphanumeric token (48 characters) stored on `userApiKey.webhookToken`.
2. Generate or rotate it in **Settings → API Keys → Webhooks**.
3. Routes: `GET /api/user/api-keys/getWebhookToken` and `POST /api/user/api-keys/generateWebhookToken` in `userApiKey.route.ts`.
4. Send header `X-Webhook-Token` (or `Authorization: Bearer …`).

### Endpoints

Mounted at `/api/webhook` (`webhook.route.ts`):

| Method | Path | Purpose |
| :--- | :--- | :--- |
| GET | `/about` | catalog |
| POST | `/search` | notes, tasks, life events, memos, info vault |
| POST | `/notes/search`, `/notes/get` | notes (read only) |
| POST | `/tasks/search`, `/tasks/get` | tasks (read only) |
| POST | `/life-events/search`, `/memo/search`, `/info-vault/search` | other domains |
| POST | `/files/add`, `/files/list` | attach a file to a chat message (`messageId` required, JSON + base64, max 8MB) |

On the host, the public URL is `http://localhost:3000/api/webhook/*`. Vite proxies `/api` to the API (port 2000).

---

## 19. MCP for OpenCode (`/api/mcp`)

OpenCode searches notes/tasks and attaches files through **MCP tools**, not `WEBHOOK.md` or webhook env vars.

### Token

1. Each user has one alphanumeric token (48 characters) stored on `userApiKey.mcpBearerToken`.
2. Generate or rotate it in **Settings → API Keys → MCP**. Agent (Opencode) also creates one automatically when it writes `opencode.json`.
3. Routes: `GET /api/user/api-keys/getMcpBearerToken` and `POST /api/user/api-keys/generateMcpBearerToken`. Refresh-token returns `mcpBearerTokenValid` only (never the secret).
4. Auth header: `Authorization: Bearer <mcpBearerToken>` (or `X-MCP-Bearer`). Cookie/device auth is not used. Cookie middleware skips `/api/mcp` the same way it skips `/api/webhook`.

### Server

Streamable HTTP on the API process: `POST`/`GET`/`DELETE` `/api/mcp`. Browser URL is `http://localhost:2000/api/mcp` (call the API directly; do not use the Vite `/api` proxy). From Agent Workspace Docker the URL is `http://host.docker.internal:2000/api/mcp` (`mcpAgentBaseUrl()` rewrites localhost).

### Tools

| Tool | Purpose |
| :--- | :--- |
| `search` | Read-only search. Args: `query`, `source` (`all` \| `notes` \| `tasks` \| `lifeEvents` \| `memo` \| `infoVault`). Returns `{ source, id, title, summary }` hits. |
| `add_chat_file` | Attach a file to the current AI chat message (`fileUrl` / `fileUrlArr`). Args: `fileName`, `contentBase64` or UTF-8 `content`, optional `mimeType` / `messageId`. Default `messageId` is header `X-Chat-Message-Id`. Max 8MB. |

No MCP tools create or update notes or tasks.

### OpenCode context

Each settings step writes `agent-workspace/opencode.json` with:

```json
"mcp": {
  "ai-notes-xyz": {
    "type": "remote",
    "url": "http://host.docker.internal:2000/api/mcp",
    "enabled": true,
    "oauth": false,
    "headers": {
      "Authorization": "Bearer <mcpBearerToken>",
      "X-Chat-Message-Id": "<chatMessageId>"
    }
  }
}
```

`.env` may still include `CHAT_MESSAGE_ID`. The MCP header is the source of truth for attach-file. The instruction tells the model to use MCP tools `search` and `add_chat_file`. Existing `permission['*']: 'allow'` lets OpenCode invoke those tools.

Agent Workspace compose includes `extra_hosts: ["host.docker.internal:host-gateway"]`. No image rebuild is required for MCP API or client changes.

