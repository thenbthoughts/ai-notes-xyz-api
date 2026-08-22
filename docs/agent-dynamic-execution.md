# Agent (Opencode) — Dynamic Execution (No Hardcoding)

This document defines the **dynamic execution model** for Agent (Opencode). The agent must figure out what work to do for each user request and solve it by writing code, installing libraries, and running commands. There is **no pre-defined fallback** — either solve dynamically or clearly reject.

## Core Principle

**No hardcoding.** The API and the agent must not contain `if prompt contains "rotate" → run convert` or `if prompt contains "excel" → run pandas` branches. Instead, the agent receives a generic capability description and must **dynamically decide** what libraries/scripts/commands are needed for the specific request.

## What the Agent Can Do

The agent runs inside `ai-notes-xyz-agent-workspace` (a sandboxed Linux container, `/config` is `FILE_STORAGE_PATH`) with full shell access via the `bash` tool.

### Code Execution

- **Node.js**: `write` tool → create `script.js` → `bash: node script.js`
  - Install any npm package: `npm install <package>` or `npm init -y && npm install <pkg>`
  - Examples: `exceljs` for Excel, `pdf-lib` for PDF, `jimp`/`sharp` for images, etc.

- **Python**: `write` tool → create `script.py` → `bash: python3 script.py`
  - Install any pip package: `pip install -q <package>` or `pip install --no-cache-dir <package>`
  - Examples: `pandas`+`openpyxl` for Excel, `pillow` for images, `reportlab` for PDFs, etc.

- **Shell**: Any command via `bash` tool: `ls`, `cat`, `convert`, `mogrify`, `ffmpeg`, `soffice`, `pip`, `npm`, `node`, `python3`, `git`, etc.

### System Tools Already Available

- **ImageMagick** `convert`/`mogrify` (image rotate/crop/resize)
- **ffmpeg** (video/audio)
- **LibreOffice** `soffice` (office docs)
- **Node.js 24 + npm**, **Python 3 + pip**
- Any other tool you install at runtime

### How to Solve a Task

1. **Analyze** the user request (the latest user message is the source of truth; `CHAT.md` and `uploads/` are context).
2. **Decide** what is needed: which language, which libraries, which shell commands.
3. **Write** script(s) to `agent-workspace/` using `write`/`edit` tools (use relative paths like `script.js`, `output.xlsx`, `uploads/rotated.png`).
4. **Install** required dependencies via `bash` (`pip install`, `npm install`).
5. **Run** the script/commands via `bash` and verify output (`ls -lh`, `cat`, etc.).
6. **Write** the final Markdown answer to `ANSWER.md` and print it (the chat bubble is the last `text` part).

### No Fallback, Just Reject

- **Do NOT** fallback to a hardcoded alternative if a library is missing. Instead, **install it dynamically** and then generate the correct output.
  - Bad: `pandas not installed → create CSV and say "open CSV in Excel"`
  - Good: `pip install -q pandas openpyxl && python3 -c "import pandas as pd; df.to_excel('output.xlsx')"`

- **Do NOT** say “I cannot rotate images, I can only read/write text” when uploads contain images. Use `convert`/`mogrify` or Python `PIL` via bash.

- If after attempting (writing scripts, installing packages, running commands) you still cannot solve the task, **clearly reject** the request with an explanation. Do not silently create a wrong format (e.g., do not create CSV when Excel was requested).

## Context Injected to the Agent

Every turn, the pipeline sends a `noReply` message with:

```
Context for this OpenCode session (do not reply)...
Working directory is the isolated agent-workspace. Transcript is in CHAT.md.
Uploads are under uploads/: <list>
Use relative paths only...
=== DYNAMIC PROBLEM SOLVING (NO HARDCODING) ===
You must dynamically figure out what the user wants and solve it by writing code, installing packages, and running commands. There is no pre-defined fallback — either solve dynamically or clearly reject.
- Analyze the request, decide what libraries/scripts/commands are needed, and execute via bash tool.
- You can write any Node.js script and install any npm package.
- You can write any Python script and install any pip package.
- You can run any shell command...
- Do NOT fallback to a hardcoded alternative if a library is missing...
- If after attempting you still cannot solve, clearly reject...
```

This is set in `agentOpencodeStepCall.ts: buildNoReplyContext` and is **generic** — no per-task `if` branches.

## Implementation Notes (API)

- `agentOpencodeStepCall.ts` contains **no** `tryAutoRotate` / `tryAutoGenerateExcel` hardcoding. It only:
  - Writes `INSTRUCTION.md`/`ANSWER.md` fallbacks for legacy file truth
  - Sends `buildNoReplyContext` + real user message `parts` (including `file://` attachments for uploads) via `opencodeCreateSessionViaShell` / `opencodePromptSessionViaShell` (which `POST /session` and `POST /session/:id/message` through `shell-engine/run-shell/execute` → `curl -u opencode:$OPENCODE_SERVER_PASSWORD http://localhost:4096` inside the container)
  - Takes assistant `text` parts as answer, writes `output/prompt-{id}.md`, updates `chatMessageId`

- No `if prompt.contains("rotate")` or `if prompt.contains("excel")` branches exist. The agent itself decides.

## Examples (Dynamic, Not Hardcoded)

- **User: “rotate the image”** → Agent lists `uploads/`, picks image, runs `convert "uploads/input.jpg" -rotate 90 "uploads/rotated_90.jpg"` or writes `rotate.py` with `PIL.Image.rotate`, verifies, answers with new file path.
- **User: “create 100 passwords and also in excel”** → Agent writes `gen.py` that `import secrets, string, pandas`, `pip install pandas openpyxl` if needed, `DataFrame(...).to_excel("passwords.xlsx")`, verifies `ls -lh`.
- **User: “create PDF report”** → Agent `pip install reportlab` + `python3` to generate PDF.

All are solved by the **same generic mechanism**: write script → install deps → run → verify.

## Failure Handling

If the agent cannot solve after trying, it must return a clear rejection like:

> I tried to [what was attempted: e.g., `pip install …`, `node …`] but [error]. I cannot complete this task because [reason]. Please [suggestion].

The API will then `throw new Error("OpenCode did not return an answer...")` and the pipeline marks the instance `failed` with `errorReason`, showing `Agent (Opencode) failed.` in chat. No silent fallback file is created.

## Related Files

- `src/routes/chatLlm/chatLlmCrud/agentOpencode/pipeline/agentOpencodeStepCall.ts` — `buildNoReplyContext` + `opencodeCreateSessionViaShell`/`opencodePromptSessionViaShell`
- `src/routes/chatLlm/chatLlmCrud/agentOpencode/agentOpencodeServer.ts` — `runCurlViaShell` (container localhost:4096)
- `docs/loop.md` / `docs/agent-opencode-requirement.md` — overall loop

