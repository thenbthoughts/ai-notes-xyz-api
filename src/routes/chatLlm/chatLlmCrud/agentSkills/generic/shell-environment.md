# Shell Environment (Generic) — PREFERRED

## When
Requirement involves persistent artifact or terminal (write/read/execute, install, run) — try shell FIRST for all tasks.

## Capabilities
- Write file, read file, execute command, install npm (`npm install`), run node (`node script.js`) or python (`python3 script.py`)
- Divide file by complexity (split large file, process per chunk, merge)
- Just add the question, execute the solution — infer tools from requirement
- Print `OUT=<absolute path>` and `SIZE=<bytes>` when done
- Preference: Shell first; GUI only if required (see gui-desktop)

## Workspace
- Files: `ai-notes-xyz-agent-workspace/shell/agent/{threadId}/`, absolute `/config/`
