/**
 * Single source of truth for Shell Engine Docker environment context
 * (from ai-notes-xyz-opencode-custom-utils Dockerfile + README).
 */

export const AGENT_SHELL_ENV_BLURB = `SHELL ENGINE ENVIRONMENT (always true for execute_script):
- Ubuntu 24.04 Docker; Node.js 24; Python 3 (use python3, not python); npm; pip; apt-get; git; ffmpeg; openssl.
- Chromium via google-chrome-stable; aliases: chromium, chromium-browser. NEVER use snap or apt chromium-browser metapackage.
- Puppeteer is global; PUPPETEER_SKIP_DOWNLOAD=true; use CHROME_BIN / PUPPETEER_EXECUTABLE_PATH or /usr/bin/google-chrome-stable.
- Workspace: ai-notes-xyz-shell-files/agent/{threadId}/ with uploads/ for user files.
- Prefer Node for .js; Python3 + Pillow for image resize/compress. npm init -y / pip install allowed when needed.
- Python pip: use --break-system-packages or a local .agent_venv (PEP 668). For .xlsx prefer openpyxl (not csv when xlsx asked).
- Paths must stay under ai-notes-xyz-shell-files (no ..).
- Safety: draft email content as files OK; git clone/fetch/pull OK; do NOT send email/SMS/webhooks; do NOT git push or publish to remotes.`.trim();

export type BuiltinAgentSkillSeed = {
    name: string;
    description: string;
    body: string;
};

export const BUILTIN_AGENT_SKILL_SEEDS: BuiltinAgentSkillSeed[] = [
    {
        name: 'shell-environment',
        description:
            'Documents the Shell Engine Docker runtime (Ubuntu 24.04, Node 24, Python 3, Chromium, ffmpeg, workspace paths). Use when writing or debugging execute_script, installing packages, screenshots, or media processing in the agent workspace.',
        body: `# Shell Environment

## Runtime
- OS: Ubuntu 24.04 in Docker
- Node.js 24, npm; Python 3 via \`python3\` (system \`python\` may be missing)
- apt-get, build-essential, git, openssl, ffmpeg, zip/unzip, sqlite3
- Google Chrome stable installed; \`chromium\` and \`chromium-browser\` are aliases to it
- Do **not** use snap or \`apt-get install chromium-browser\` (snap stub fails in Docker)
- Puppeteer installed globally with \`PUPPETEER_SKIP_DOWNLOAD=true\` — use system Chrome

## Workspace
- Agent files live under \`ai-notes-xyz-shell-files/agent/{threadId}/\`
- User uploads: \`.../uploads/{id}_{filename}\`
- Relative paths for scripts should be workspace-local; prefer absolute paths returned by shell write when running commands

## Script rules
- \`.py\` → \`python3\`; \`.js\` → \`node\` — never run Python with node
- Image work: Pillow (\`pip install pillow\` if needed), write outputs next to uploads
- Screenshots: \`chromium --headless=new --no-sandbox --disable-dev-shm-usage --screenshot=out.png 'URL'\`
- May \`npm init -y\` and install packages inside the agent folder when required
- Python installs: use \`python3 -m pip install --break-system-packages PKG\` or a local venv (\`.agent_venv\`) — PEP 668 blocks bare pip
- Excel \`.xlsx\`: prefer \`openpyxl\` alone (do not require pandas); never substitute \`.csv\` when \`.xlsx\` was requested

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
            'Image and media processing with Python Pillow or ffmpeg in the Shell Engine. Use when resizing, compressing, converting images/video, or when the user attaches photos and asks to reduce size or transform media.',
        body: `# Image & Media

## Prefer
- \`execute_script\` with \`scriptType: "python"\` and a \`.py\` filename
- Pillow for resize/compress/convert still images
- ffmpeg CLI for video/audio when needed

## Patterns
- Locate uploads under \`uploads/\` in the agent workspace (prefixed filenames)
- Compress JPEG: open → convert RGB → \`save(..., quality=..., optimize=True)\` loop until under target KB
- Print final path and size in KB to stdout so verify/synthesize can confirm
- Install deps if missing: \`pip install pillow\` via a short setup script or shell in the same script

## Avoid
- Running \`.py\` with node
- Assuming \`python\` exists — use \`python3\`
`,
    },
    {
        name: 'document-pdf',
        description:
            'Create PDF documents in the Shell Engine with Python (reportlab or fpdf2). Use when the user asks to create/generate a PDF, including timestamps, India/IST time, or short reports.',
        body: `# Document PDF

## Prefer
- \`execute_script\` with \`scriptType: "python"\` and a \`.py\` filename
- \`python3\`; install with \`pip install reportlab\` or \`pip install fpdf2\` if needed

## Pattern (IST / India time example)
\`\`\`python
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
# pip install reportlab  (run once in script if ImportError)
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter

out = Path("india_time.pdf").resolve()
now = datetime.now(ZoneInfo("Asia/Kolkata"))
c = canvas.Canvas(str(out), pagesize=letter)
c.drawString(72, 720, "Current time in India (IST)")
c.drawString(72, 700, now.strftime("%Y-%m-%d %H:%M:%S %Z"))
c.save()
print(f"PDF_PATH={out}")
print(f"SIZE_BYTES={out.stat().st_size}")
\`\`\`

## Rules
- Always print absolute path and size on stdout
- Never claim success without a real file on disk
- Do not search personal notes/tasks for create-PDF goals
- Use \`list_workspace_files\` if the user asks where the file is
`,
    },
];
