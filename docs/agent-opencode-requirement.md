# Agent (Opencode) requirements

This note is the **must / must not** list for Agent (Opencode).

Use it when changing code so Opencode does not mix with Concise, Agent (beta), or Cursor.

See also: [loop.md](./loop.md) and [agent-opencode-loop.md](./agent-opencode-loop.md)

---

## 1. Product

### Step 1 — It is a third answer engine

Chat already has:

1. **Concise** (`conciseAnswer`)
2. **Agent (beta)** (`agent`)

Add a third, named **Agent (Opencode)** (`agentOpencode`).

The user picks it on **New chat** and in **thread settings**. History can filter **Opencode** threads.

### Step 2 — The worker is OpenCode, not Cursor

1. Do **not** call Cursor SDK (`@cursor/sdk`, `Agent.prompt`).
2. Do **not** store a Cursor API key (`apiKeyCursor` / `apiKeyCursorValid`).
3. Do **not** put a Cursor row in Settings → API Keys.
4. Call **OpenCode** (`opencode run`) in the Agent Workspace folder.
5. Feed OpenCode the user’s Groq / OpenRouter / OpenAI / Ollama / LocalAI keys from Settings.

### Step 3 — What the user should feel

1. Send a message.
2. See a short “started” line in chat.
3. Wait a few seconds.
4. See the **output file** as the chat reply (not a dump of planned file paths).
5. Files for the task live in an isolated workspace folder for that thread.

---

## 2. Isolation (hard rules)

Opencode must stay **separate** from Agent (beta). Do not reuse beta internals.

### Must not use

1. `SchemaAgent*` / `agentInstance` (beta tables)
2. `agentInitiateFunc`
3. Agent (beta) tick cron
4. `POST /api/chat-llm/add-auto-next-message/agent`
5. Workspace prefix `shell/agent/`
6. Beta memory, goals, citations, or tool registry
7. Cursor API keys or Cursor SDK

### Must use instead

1. Collection `agentOpencodeInstance`
2. Code under `src/routes/chatLlm/chatLlmCrud/agentOpencode/`
3. Cron `agentOpencodeCronTick` only
4. Routes under `/api/chat-llm/agent-opencode/`
5. Workspace prefix `shell/agent-opencode/`
6. Chat tag `agentOpencode`
7. OpenCode config files in `agent-workspace/opencode.json`

If a change needs a beta helper, copy or write a new helper. Do not import the beta loop.

---

## 3. Send vs work

### Step 1 — Send only starts a run

On send, the API must **only**:

1. Save the user message (normal chat).
2. Insert a **pending** `agentOpencodeInstance` row.
3. Insert one AI chat bubble with the start text.

Send must **not** call OpenCode and must **not** write the full workspace in the request.

### Step 2 — Cron does the work

A cron job every **5 seconds**, with **no overlap**, must:

1. Pick one pending row that is not already running.
2. Run **input → settings → OpenCode → output**.
3. Update the **same** AI bubble from `output/prompt-{id}.md`.

---

## 4. Thread and shell flags

1. Thread field: `answerEngine = agentOpencode`.
2. **`executeShell` stays false** for this engine. Opencode does not use the Agent (beta) shell-execute switch. The pipeline may still call Agent Workspace `run-shell/execute` **only** to run `opencode run`.
3. Init must reject threads that are not `agentOpencode`.

---

## 5. Workspace layout

All Opencode files must live under:

```
ai-notes-xyz-agent-workspace/shell/agent-opencode/{thread-id}/
```

### Required folders

| Path | Role |
| :--- | :--- |
| `input/prompt-{instance-id}.md` | User instruction for this run |
| `agent-workspace/` | OpenCode working directory (files the task creates) |
| `agent-workspace/opencode.json` | OpenCode settings with copied API keys |
| `agent-workspace/.env` | Same keys as env vars |
| `output/prompt-{instance-id}.md` | Final answer shown in chat |

Rules:

1. Paths must start with `shell/agent-opencode/`. Reject `..` and other prefixes.
2. Do not write Opencode files under `shell/agent/` (beta).
3. One thread id → one Opencode folder. Each run uses its own `prompt-{instance-id}.md` names.

---

## 6. Database row

Collection: `agentOpencodeInstance`

### Status

| Status | Meaning |
| :--- | :--- |
| `pending` | Saved, waiting for cron |
| `filesInitialized` | Pipeline finished; output file exists |
| `failed` | Pipeline or cron error |

Also:

1. `statusIsRunning` — true while cron is working on this row.
2. `pipelineStep` — `input` \| `settings` \| `opencode` \| `output` \| `done` (or empty before start).
3. `errorReason` — filled on failure.
4. `promptText` — copy of the user message.
5. `chatMessageId` — the AI bubble to update.

### One pending run per thread

If the user sends again before cron finishes the last pending run, mark the old pending row **failed** (“superseded”) and start a new one.

---

## 7. Chat text

1. **Start (init):**  
   `Agent (Opencode) started. Workspace will be initialized shortly.`
2. **While copying keys:**  
   `Agent (Opencode) started. Copying Groq / OpenRouter keys into OpenCode settings...`
3. **While calling OpenCode:**  
   `Agent (Opencode) started. Calling OpenCode with the instruction...`
4. **Success:** content of `output/prompt-{id}.md` (read back from Agent Workspace).
5. **Failure:**  
   `Agent (Opencode) failed.` plus the error.

Do not show a list of planned file paths as the user-facing answer.

---

## 8. Copy keys, then call OpenCode

### Step 1 — Copy keys from Settings

Source of truth: `SchemaUserApiKey` (saved by `userApiKey.route.ts`).

Write them into the OpenCode folder **before** calling OpenCode:

1. Groq → provider `groq` + `GROQ_API_KEY`
2. OpenRouter → provider `openrouter` + `OPENROUTER_API_KEY`
3. OpenAI → provider `openai` + `OPENAI_API_KEY`
4. Ollama → provider `ollama` + `OLLAMA_HOST`
5. LocalAI → provider `localai` + `LOCALAI_BASE_URL`
6. Replicate / RunPod as env vars when valid

Need at least one of Groq, OpenRouter, OpenAI, Ollama, or LocalAI.

### Step 2 — Call OpenCode

1. Working directory: remote `agent-workspace/` on Agent Workspace
2. Command: `opencode run --model <provider/model> "<instruction>"`
3. Load `.env` in that directory first
4. Model preference: OpenRouter, then Groq, then OpenAI, then the first configured provider
5. Do not use Cursor as the worker

---

## 9. API keys (Settings)

Keep the same Groq / OpenRouter / … screens. **Do not add a Cursor key.**

### Agent Workspace key

Needed to read/write folders and to run `opencode`. Use the user’s Agent Workspace URL + token, or the `AM4_SHELL_ENGINE_*` / `SHELL_ENGINE_*` env fallback. If missing, fail with a Settings message.

---

## 10. HTTP API

All routes require a logged-in user. Mount at `/api/chat-llm/agent-opencode`.

| Method | Path | Role |
| :--- | :--- | :--- |
| POST | `/init` | Create pending run from last user message |
| POST | `/status` | Latest run + recent list for the thread |
| POST | `/instance-list` | List runs for the thread |
| POST | `/instance-by-id` | One run |

Do **not** add Opencode onto `/add-auto-next-message/agent`.

---

## 11. Client UI

1. New chat radio: **Agent (Opencode)**
2. Thread settings radio: same
3. History tab filter for Opencode threads
4. On send / regenerate in an Opencode thread: call `/agent-opencode/init`, not the beta agent URL
5. Poll `/status` while a run may be pending, then refresh chat
6. Pipeline label: `input → settings → opencode → output`
7. No Cursor API key screen

---

## 12. Cron

1. Schedule: every 5 seconds (`*/5 * * * * *`)
2. `noOverlap: true`
3. Pick oldest `pending` + `statusIsRunning = false`
4. Set `statusIsRunning = true` before work
5. On throw: `failed`, `statusIsRunning = false`, write error to chat

Do not run this work on the Agent (beta) cron.

---

## 13. Cleanup

When a thread is deleted:

1. Delete `agentOpencodeInstance` rows for that thread and user
2. Delete remote `shell/agent-opencode/{thread-id}/` if Agent Workspace is configured
3. Do not delete `shell/agent/{thread-id}/` (beta)

---

## 14. Tests

1. Use the Opencode runner (`run-task-opencode.ts` / `agentOpencodeTestHarness.ts`), **not** Agent (beta) `run-task.ts`.
2. Create threads with `answerEngine: agentOpencode` and `executeShell: false`.
3. Upload fixtures under `shell/agent-opencode/{threadId}/agent-workspace/`.
4. Reports should set `engine: agentOpencode`.
5. Need a valid Groq or OpenRouter (or other LLM) key, plus Agent Workspace. Do not require a Cursor key.

---

## 15. Checklist before merging a change

1. No import of Agent (beta) initiate / tick / `SchemaAgent`.
2. Files only under `shell/agent-opencode/`.
3. Send still does not call OpenCode.
4. Chat still comes from `output/prompt-{id}.md`.
5. Pipeline is still **input → copy keys → OpenCode → output**.
6. `executeShell` is still not used as the Opencode worker switch.
7. No Cursor API key field, route, or Settings screen.
8. Groq / OpenRouter / etc. from Settings are copied into `opencode.json` before `opencode run`.
9. **Dynamic execution only** — no hardcoding per task (see `agent-dynamic-execution.md`). Agent must figure out what to do, may `write` Node/Python scripts, `npm/pip install` any library, and run via `bash`; if it cannot solve, it must reject, not fallback to a wrong format.
