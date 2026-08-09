# Agent use-case runners

Use-cases live in `../use-cases/task-*/task.md`.

## Run one

```bash
cd ai-notes-xyz-api
npx ts-node -r dotenv/config ./srcTest/2026-08-06-make-agent-better/testCasesByJs/run-task.ts task-006-write-hello-world-file
```

## Run a batch

```bash
# default smoke set
npx ts-node -r dotenv/config ./srcTest/2026-08-06-make-agent-better/testCasesByJs/run-all.ts

AGENT_TEST_BATCH=core   npx ts-node -r dotenv/config ./srcTest/2026-08-06-make-agent-better/testCasesByJs/run-all.ts
AGENT_TEST_BATCH=safety npx ts-node -r dotenv/config ./srcTest/2026-08-06-make-agent-better/testCasesByJs/run-all.ts
AGENT_TEST_ONLY=task-135-draft-email-content npx ts-node -r dotenv/config ./srcTest/2026-08-06-make-agent-better/testCasesByJs/run-all.ts
```

## Safety policy (agent + use-cases)

- **Allowed:** local shell, installs, `git clone`/`fetch`/`pull`, draft email/message files
- **Blocked:** send email/SMS/webhooks, `git push` / force-push, remote publish

## Env

| Var | Purpose |
|---|---|
| `AGENT_TEST_USER_ID` | User ObjectId |
| `AGENT_TEST_MODEL_PROVIDER` | default `openrouter` |
| `AGENT_TEST_MODEL_NAME` | default `google/gemma-4-26b-a4b-it` |
| `AGENT_TEST_TIMEOUT_MS` | default `600000` |
| `AGENT_TEST_BATCH` | `smoke` (default) / `core` / `safety` / `all` |
| `AGENT_TEST_ONLY` | single slug |

Reports: `../use-cases/<slug>/reports/`.
