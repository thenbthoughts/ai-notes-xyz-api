// Every DApp repo holds ONLY app code (seeded from src_template/), never platform files.
// The template repo is the Coolify build source; the app repo URL + branch arrive
// as runtime env and server-manage clones them on first boot.
// First build (no code/.git yet): shallow-clone the template to a temp dir, copy
// src_template/* into code/, start a fresh dev branch. Resend (code/.git exists):
// keep the agent's work, commit anything new, push dev again.

const DAPPS_TEMPLATE_REPO =
    String(process.env.DAPPS_TEMPLATE_REPO || 'https://github.com/thenbthoughts/ai-notes-xyz-dapps-template.git').trim() ||
    'https://github.com/thenbthoughts/ai-notes-xyz-dapps-template.git';

const DAPPS_TEMPLATE_BRANCH =
    String(process.env.DAPPS_TEMPLATE_BRANCH || 'main').trim() || 'main';

const buildDappsEnvFile = ({ mongodbUri, appId, appPort, basicAuthUsername, basicAuthPassword, manageToken }: {
    mongodbUri: string;
    appId: string;
    appPort: number;
    basicAuthUsername: string;
    basicAuthPassword: string;
    manageToken: string;
}): string => {
    return `MONGODB_URI=${mongodbUri || ''}\nAPP_ID=${appId}\nAPP_PORT=${appPort}\nBASIC_AUTH_USER=${basicAuthUsername}\nBASIC_AUTH_PASSWORD=${basicAuthPassword}\nMANAGE_TOKEN=${manageToken}\n`;
};

const buildTemplateCloneCommand = ({ safeDir, authedUrl, remoteUrl, chatMd, envFile }: {
    safeDir: string;
    authedUrl: string;
    remoteUrl: string;
    chatMd: string;
    envFile: string;
}): string => {
    const shQ = (s: string): string => `'${String(s).replace(/'/g, `'\\''`)}'`;
    return [
        'ROOT="${FILE_STORAGE_PATH:-/config}"',
        `DIR="$ROOT"/${shQ(safeDir)}`,
        'mkdir -p "$DIR/uploads"',
        `printf %s ${shQ(chatMd)} | base64 -d > "$DIR/CHAT.md" || true`,
        `echo '# answer' > "$DIR/ANSWER.md"`,
        `printf %s ${shQ(envFile)} | base64 -d > "$DIR/.env"`,
        `printf %s ${shQ('{"models":[]}')} > "$DIR/opencode.json"`,
        `if [ ! -d "$DIR/code/.git" ]; then rm -rf "$DIR/code" "$DIR/tpl"; git clone --depth 1 --branch ${shQ(DAPPS_TEMPLATE_BRANCH)} ${shQ(DAPPS_TEMPLATE_REPO)} "$DIR/tpl" || { echo "TEMPLATE_CLONE_FAILED: push the template to GitHub first, then Resend."; exit 1; }; mkdir -p "$DIR/code"; cp -r "$DIR/tpl/src_template/." "$DIR/code/"; rm -rf "$DIR/tpl"; fi`,
        'cd "$DIR/code"',
        'if [ ! -d .git ]; then git init -b dev; fi',
        'git config user.email "dapps@localhost"',
        'git config user.name "dapps"',
        'git checkout -B dev',
        'git add -A',
        'git commit -m "dapps dev build" || true',
        `git remote remove origin 2>/dev/null || true`,
        `git remote add origin ${shQ(authedUrl)}`,
        'git push -u origin dev --force',
        `git remote set-url origin ${shQ(remoteUrl)}`,
        'git log --oneline -3',
    ].join('\n');
};

export {
    DAPPS_TEMPLATE_BRANCH,
    DAPPS_TEMPLATE_REPO,
    buildDappsEnvFile,
    buildTemplateCloneCommand,
};
