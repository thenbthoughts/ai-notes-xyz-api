/**
 * GUI Docker context for ai-notes-xyz-agent-workspace.
 * Simple, single file, generic.
 */

export const AGENT_GUI_ENV_BLURB = `GUI DESKTOP (ai-notes-xyz-agent-workspace):
- Ubuntu XFCE webtop Docker, web desktop on :3010/:3011 (user abc / agentworkspace), VNC-like.
- Workspace files under ai-notes-xyz-agent-workspace/shell/agent/{threadId}/, absolute /config/ (FILE_STORAGE_PATH).
- Tools: Node 24, Python3, Chromium (google-chrome-stable), LibreOffice soffice, ffmpeg, zip/unzip, VS Code.
- Human-like capabilities: test file in browser (google-chrome-stable --headless --disable-gpu --no-sandbox --screenshot=out.png file:///config/.../index.html, --print-to-pdf), make zip (zip -r out.zip folder/), use app (code, soffice --convert-to), record, etc.
- Ports 2000 API, 2001 workspace API, 3000 web, 3010/3011 desktop reserved — never listen on them.
- Use when requirement implies browser test, archive, or desktop app.` .trim();

export type GuiSkillSeed = {
    name: string;
    description: string;
    body: string;
};

export const GUI_SKILL_SEEDS: GuiSkillSeed[] = [
    {
        name: 'gui-desktop',
        description: 'GUI desktop and browser/zip/app capabilities in ai-notes-xyz-agent-workspace.',
        body: `# GUI Desktop
## Runtime
- Ubuntu XFCE webtop Docker, desktop :3010/:3011, user abc
- Chromium stable, ffmpeg, zip, soffice

## Workspace
- Files: ai-notes-xyz-agent-workspace/shell/agent/{threadId}/, /config/

## Human-like
- Test file in browser: google-chrome-stable --headless --disable-gpu --no-sandbox --screenshot=out.png file:///config/.../file.html
- Make zip: zip -r /config/.../out.zip folder/
- Use app: soffice --headless --convert-to pdf input.docx
`,
    },
];
