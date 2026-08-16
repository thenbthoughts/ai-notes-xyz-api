# GUI Desktop (Generic) — USE ONLY IF REQUIRED (shell is preferred)

## When
Requirement implies browser test, zip, or desktop app AND shell cannot verify; try shell first.

## Capabilities
- Test file in browser: `google-chrome-stable --headless --disable-gpu --no-sandbox --screenshot=out.png file:///config/.../file.html`, then pass screenshot to vision LLM via `image_to_text` (relativePath=out.png)
- Make zip: `zip -r /config/.../out.zip folder/` (shell)
- Use app: `soffice --headless --convert-to pdf input.docx`, `code`
- Desktop: Ubuntu XFCE webtop :3010/:3011, user abc
- Preference: Shell first for all; GUI + screenshot→vision only when visual verification required

## Workspace
- Files: `ai-notes-xyz-agent-workspace/shell/agent/{threadId}/`, absolute `/config/`
