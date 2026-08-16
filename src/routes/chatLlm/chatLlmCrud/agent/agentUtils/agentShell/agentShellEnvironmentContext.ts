/**
 * Single source of truth for Agent Workspace Docker environment context
 * (from ai-notes-xyz-agent-workspace Dockerfile + README).
 */

export const AGENT_SHELL_ENV_BLURB = `AGENT WORKSPACE ENVIRONMENT (always true for execute_script):
- Ubuntu XFCE webtop Docker; Node.js 24; Python 3 (use python3, not python); npm; pip; apt-get; git; ffmpeg; openssl; LibreOffice; VS Code.
- Chromium via google-chrome-stable; aliases: chromium, chromium-browser. NEVER use snap or apt chromium-browser metapackage.
- Workspace: ai-notes-xyz-agent-workspace/shell/agent/{threadId}/ with uploads/ for user files and index-data-{threadId}/ for folder search indexes. You can write file, read file, execute command, install npm, run node/python. Divide file by complexity when needed (split large file, process per chunk, merge). Just add the question, execute the solution — infer from requirement.
- PREFERENCE: Try shell first for all tasks (execute_script). Use GUI only if required (browser rendering test, visual verification, desktop app). For GUI, take screenshot and pass to vision LLM via image_to_text.
- Prefer Node for .js; Python3 + Pillow for image resize/compress; soffice/LibreOffice for office/PDF when useful. npm init -y / pip install allowed when needed.
- Scripts must exit. Do not listen on ports 2000, 2001, 3000, 3010, or 3011. Demo HTTP: 127.0.0.1 and port 18080+ or 0, then exit.
- Python pip: use --break-system-packages or a local .agent_venv (PEP 668). For .xlsx prefer openpyxl (not csv when xlsx asked).
- Paths must stay under ai-notes-xyz-agent-workspace/shell or .../features (no ..). Absolute paths are under /config/.
- Safety: draft email content as files OK; git clone/fetch/pull OK; do NOT send email/SMS/webhooks; do NOT git push or publish to remotes.`.trim();

export const AGENT_GUI_ENV_BLURB = `GUI DESKTOP (ai-notes-xyz-agent-workspace) — USE ONLY IF REQUIRED (shell is preferred):
- Ubuntu XFCE webtop Docker, desktop on :3010/:3011 (user abc / agentworkspace), VNC-like.
- Workspace files under ai-notes-xyz-agent-workspace/shell/agent/{threadId}/, absolute /config/ (FILE_STORAGE_PATH).
- Human-like (only when shell insufficient): test file in browser (google-chrome-stable --headless --disable-gpu --no-sandbox --screenshot=out.png file:///config/.../index.html, then image_to_text for vision LLM), make zip (zip -r out.zip folder/), use app (code, soffice --convert-to), etc. For any GUI visual check, take screenshot and pass to vision LLM via image_to_text tool.
- Ports 2000 API, 2001 workspace API, 3000 web, 3010/3011 desktop reserved.
- Use when requirement implies browser test, archive, or desktop app and shell cannot verify — infer from requirement, generic, shell-first.`.trim();

export type BuiltinAgentSkillSeed = {
    name: string;
    description: string;
    body: string;
};

export const BUILTIN_AGENT_SKILL_SEEDS: BuiltinAgentSkillSeed[] = [
    {
        name: 'shell-environment',
        description:
            'Documents the Agent Workspace Docker runtime (Ubuntu XFCE webtop, Node 24, Python 3, Chromium, LibreOffice, VS Code, ffmpeg, workspace paths). Use when writing or debugging execute_script, installing packages, screenshots, or media processing in the agent workspace.',
        body: `# Shell Environment

## Runtime
- OS: Ubuntu XFCE webtop in Docker
- Node.js 24, npm; Python 3 via \`python3\` (system \`python\` may be missing)
- apt-get, build-essential, git, openssl, ffmpeg, zip/unzip, sqlite3, LibreOffice (\`soffice\`), VS Code
- Google Chrome stable installed; \`chromium\` and \`chromium-browser\` are aliases to it
- Do **not** use snap or \`apt-get install chromium-browser\` (snap stub fails in Docker)
- Screenshots: \`google-chrome-stable --headless --disable-gpu --no-sandbox --screenshot=out.png file:///abs/page.html\`. Do **not** \`npm install puppeteer\`

## Workspace
- Agent files live under \`ai-notes-xyz-agent-workspace/shell/agent/{threadId}/\`
- Absolute paths are under \`/config/\` (FILE_STORAGE_PATH)
- User uploads: \`.../uploads/{id}_{filename}\`
- Folder index (skill \`index-data-chat\`): \`index-data-{threadId}/\`
- Relative paths for scripts should be workspace-local; prefer absolute paths returned by shell write when running commands

## Script rules
- \`.py\` → \`python3\`; \`.js\` → \`node\` — never run Python with node
- May install packages (npm / pip with \`--break-system-packages\` or a local \`.agent_venv\`) when needed
- Office/PDF: prefer \`soffice\` / LibreOffice convert when useful
- Prefer printing \`OUT=<absolute path>\` and \`SIZE=<bytes>\` for created outputs, then stop.
- Scripts must **exit**. Do not leave HTTP daemons running.
- Host already uses ports **2000** (API), **2001** (workspace API), **3000** (web), **3010/3011** (desktop) — never \`listen\` on those. If a demo server is required, bind \`127.0.0.1\` on **18080+** or port **0**, print the port, self-request, then exit. Prefer a CLI that prints JSON and exits.

## Safety (hard rules)
- Allowed: local shell, file edits, installs, \`git clone\` / \`fetch\` / \`pull\`, drafting email/message content as files (\`.txt\` / \`.md\` / \`.eml\`)
- Blocked: actually sending email/SMS/webhooks, \`git push\` / force-push, npm/pypi/docker publish to remotes
`,
    },
    {
        name: 'personal-research',
        description:
            'Guides personal Q&A and life-advice goals using notes, tasks, memos, life events, and info vault. Use when the user asks how to improve life, recalls personal history, or needs advice grounded in their data.',
        body: `# Personal Research

## Workflow
1. Call \`search_all_domains\` first with the user question or focused keywords.
2. Deepen with \`search_notes\`, \`search_tasks\`, \`search_memo\`, \`search_life_events\`, or \`search_info_vault\` if gaps remain.
3. Store important findings with \`write_memory\` (type observation or fact).
4. When evidence is enough, synthesize a grounded final answer — do **not** invent personal facts.
5. If evidence is thin, say what is known vs unknown and give practical next steps.

## Style
- Specific, actionable, structured (short sections / bullets)
- Cite personal themes from search hits without fabricating details
`,
    },
    {
        name: 'image-media',
        description:
            'Image and media processing with Python Pillow or ffmpeg in the Agent Workspace.',
        body: `# Image & Media

## Prefer
- OCR / read text from an uploaded image: tool \`image_to_text\` (not Pillow)
- Resize/compress/convert images: \`execute_script\` + python3 + Pillow (\`from PIL import Image\`)
- If \`import PIL\` fails: \`python3 -m pip install --break-system-packages Pillow\` — never create \`.agent_venv\` in the workspace
- JPEG has no alpha: \`.convert('RGB')\` before \`save(..., 'JPEG')\`
- HTML screenshot: system Chrome headless \`--screenshot=\` — never \`npm install puppeteer\`
- Print absolute path + size when done; write outputs in the workspace root when possible

## Avoid
- Running \`.py\` with node
- Using Pillow or tesseract when the user only wants image-to-text
`,
    },
    {
        name: 'document-pdf',
        description:
            'Create PDF documents in the Agent Workspace with Python (reportlab or fpdf2) or LibreOffice (\`soffice\`).',
        body: `# Document PDF

## Prefer
- \`execute_script\` + python3; install reportlab/fpdf2 if needed
- Print absolute path + size; never claim success without a real file

## Avoid
- Searching personal notes for create-PDF goals
`,
    },
    {
        name: 'code-nodejs',
        description:
            'Implement or refactor Node.js/JavaScript modules in the agent workspace.',
        body: `# Code Node.js

## Prefer
- Write the **named** deliverable \`.js\`/\`.mjs\` with \`execute_script\` (not \`create_artifact.js\` as the product)
- Node 24; if package.json has \`"type": "module"\`, use import/export (or \`.cjs\` for require helpers)
- Print absolute path + size when done, then stop
- Prefer a CLI that exits. If HTTP is required: bind \`127.0.0.1:18080+\` or port \`0\` — never 2000/2001/3000/3010/3011

## Avoid
- Endless analyze/report loops when the user asked for working code
- Starting a long-lived server from \`create_artifact.js\`
`,
    },
    {
        name: 'index-data-chat',
        description:
            'Index files in index-data-{chatId}/ (md, txt, pdf, ppt/pptx, xlsx, zip, images via image_to_text, and others), convert formats, then reindex. Use when the user wants a searchable folder index, RAG-style lookup over workspace docs, or convert-then-reindex.',
        body: `# Index data for this chat

## Folder (required)
Workspace: \`ai-notes-xyz-agent-workspace/shell/agent/{chatId}/\`
Index root: \`index-data-{chatId}/\` (example: \`index-data-6a7d7ed158f2310f03da399c/\`)

\`\`\`
index-data-{chatId}/
  raw/          originals (keep zip extracts here too)
  converted/    format conversions (md, txt, csv, json)
  index/        index.jsonl + manifest.json
\`\`\`

Create the three folders if missing. Do not index \`node_modules\`, \`.agent_venv\`, \`.git\`, or \`__pycache__\`.

## When to use
- User asks to index / search / reindex files in this chat workspace
- User uploads docs (md, txt, pdf, ppt, xlsx, zip, docx, html, csv, json, images) and wants them searchable
- User asks to convert one format to another, then refresh the index

## Extract text
Use \`python3\` + \`execute_script\`. Install only if import fails (\`sys.executable -m pip install --break-system-packages PKG\`).

| Format | How |
| --- | --- |
| \`.md\` \`.txt\` \`.csv\` \`.json\` \`.html\` \`.xml\` | read as UTF-8 (ignore errors) |
| \`.pdf\` | \`pypdf\` (\`PdfReader\`) |
| \`.pptx\` | \`python-pptx\` (slide shapes text) |
| \`.ppt\` | convert via LibreOffice if present, else say unsupported and skip |
| \`.xlsx\` \`.xlsm\` | \`openpyxl\` (all sheets, cell values as TSV) |
| \`.xls\` | try \`xlrd\` or convert to xlsx first |
| \`.docx\` | \`python-docx\` |
| \`.zip\` | \`unzip -o\` into \`raw/_unzipped/{zipstem}/\` then walk extracted files |
| images (\`.png\` \`.jpg\` \`.jpeg\` \`.webp\` \`.gif\`) | tool \`image_to_text\` → write \`.ocr.txt\` under \`converted/\`, then index that text |
| other | if UTF-8 text, index; else skip and list in manifest.skipped |

Chunk long files (~1200 chars, 150 overlap). Each index row:

\`\`\`json
{"id":"rel:chunk0","source":"raw/foo.pdf","format":"pdf","title":"foo.pdf","text":"...","mtimeMs":0}
\`\`\`

Write \`index/index.jsonl\` (one JSON object per line) and \`index/manifest.json\` with \`{chatId, fileCount, chunkCount, skipped[], builtAtUtc}\`.

## Search
After indexing, answer from \`index.jsonl\`: case-insensitive keyword / phrase match over \`text\` + \`source\`. Cite \`source\` paths. If nothing matches, say so.

## Convert then reindex
1. Convert in \`converted/\` (keep the original in \`raw/\`):
   - pdf/pptx/docx → \`.md\`
   - xlsx → \`.csv\` (one file per sheet: \`name.sheet.csv\`)
   - html → \`.md\` or \`.txt\`
   - images → tool \`image_to_text\` → \`.ocr.txt\`
   - zip → extract first, then convert children
2. Rebuild the whole index from \`raw/\` + \`converted/\` (do not append stale chunks).
3. Print index root path, \`index/index.jsonl\` size, fileCount, chunkCount, then stop.

## Script rules
- One \`execute_script\` can mkdir + extract + convert + write index + print stats
- Print: \`INDEX_ROOT=\` \`INDEX_FILE=\` \`SIZE=\` \`FILES=\` \`CHUNKS=\`
- Never claim indexed files that are not on disk
- Paths stay under the agent workspace (no \`..\`)
`,
    },
    {
        name: 'data-transform',
        description:
            'One-shot text/CSV/TSV/JSON/line transforms in the Agent Workspace.',
        body: `# Data Transform

## Rule
One \`execute_script\`: write the output, print \`OUT=<absolute path>\` and \`SIZE=<bytes>\`, stop.

## Prefer
- Python stdlib (\`csv\`, \`json\`, \`html.parser\`, \`re\`, \`sqlite3\`) for local file transforms
- Never import pandas or pip-install pandas for CSV/TSV/JSON/text — stdlib is enough (PEP 668)
- SQLite: \`import sqlite3\` (stdlib). Do not npm-install the Node \`sqlite3\` addon.
- Do not pip-install parsers when stdlib can do it (PEP 668 blocks bare \`pip install\`)
- JSON required-keys / type checks: \`json\` + \`isinstance\` — do not pip-install \`jsonschema\`
- The user-facing output must exist after the script runs (a converter \`.py\`/\`.js\` alone is not the deliverable)
- Sum/count/average of an input file: write \`result.txt\` (or similar), print OUT/SIZE — do not only print the number in chat

## Avoid
- Explore-only sub-goals for simple conversions
`,
    },
    {
        name: 'gui-desktop',
        description: 'GUI desktop and browser/zip/app in ai-notes-xyz-agent-workspace (human-like) — use only if shell insufficient, screenshot to vision LLM.',
        body: `# GUI Desktop — SHELL FIRST, GUI ONLY IF REQUIRED
## Runtime
- Ubuntu XFCE webtop :3010/:3011, user abc
- Chromium, ffmpeg, zip, soffice

## Human-like (only when shell cannot verify)
- Test file in browser: google-chrome-stable --headless --disable-gpu --no-sandbox --screenshot=out.png file:///config/.../file.html, then pass screenshot to vision LLM via image_to_text (e.g., image_to_text with relativePath=out.png)
- Make zip: zip -r /config/.../out.zip folder/ (shell, not GUI)
- Use app: soffice --headless --convert-to pdf input.docx
- Preference: Try shell (execute_script) first for all; use GUI + screenshot→vision only when visual verification required.
`,
    },
    {
        name: 'progress-tracking',
        description: 'Multi-message thread progress: compress old messages, key points, goal, done, structure, write progress.md.',
        body: `# Progress Tracking
- On new message in thread with multiple prior messages: compress old messages, mention key points, goal, what is done, structure progress, write file progress.md to workspace root.
- Keep context compact via summaries, human-like.
`,
    },
    {
        name: 'omniparser',
        description: 'Desktop-only GUI parsing via Replicate microsoft/omniparser-v2 (requires Replicate key and chat toggle, not for input files).',
        body: `# Omniparser — Desktop Only
- Use only for DESKTOP screenshots (e.g., gui.png, screen.png from chrome --headless --screenshot file:///config/...), NOT for input files in uploads/ (use image_to_text for input files).
- Use only if chat option Use Omniparser is enabled and Replicate key exists (check via tool error messages).
- Parse desktop screenshot: omniparser_parse with relativePath to desktop screenshot (e.g., out.png) after google-chrome-stable --headless --screenshot, then pass elements to vision LLM if needed
- Shell-first: try shell first, omniparser desktop-only if required and enabled
`,
    },
];
