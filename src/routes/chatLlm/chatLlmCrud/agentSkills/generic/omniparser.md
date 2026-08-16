# Omniparser (Generic) — Desktop Only, Replicate microsoft/omniparser-v2

## When
Requirement involves DESKTOP GUI visual parsing and Replicate key is configured, and chat option `Use Omniparser` is enabled. Not for input files in uploads/ — use image_to_text for input files. Try shell first; use omniparser desktop-only if required.

## Capabilities
- Parse DESKTOP screenshot via `omniparser_parse` (relativePath to desktop screenshot, e.g., `gui.png`, `screen.png` from chrome --headless --screenshot) to get UI elements (x,y,width,height,type,text) via Replicate
- Use after taking desktop screenshot with `google-chrome-stable --headless --screenshot` — then omniparser → elements → vision LLM via `image_to_text` if needed
- Not for input files: uploads/... input images should use `image_to_text` (vision OCR), not omniparser
- Requires Replicate API key in Settings → API Keys and toggle on in chat options

## Workspace
- Input: screenshot in workspace (e.g., `out.png`)
- Output: parsed elements stored in memory, printed as summary
