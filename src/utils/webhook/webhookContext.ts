import { webhookAgentBaseUrl } from './webhookBaseUrl';

export const WEBHOOK_ENDPOINTS = [
    { method: 'GET', path: '/about', body: '', desc: 'List webhook endpoints' },
    { method: 'POST', path: '/search', body: '{ "query": "keyword", "source": "all" }', desc: 'Search notes, tasks, life events, memos, info vault' },
    { method: 'POST', path: '/notes/search', body: '{ "query": "keyword" }', desc: 'Search notes' },
    { method: 'POST', path: '/notes/get', body: '{ "id": "<noteId>" }', desc: 'Get one note' },
    { method: 'POST', path: '/tasks/search', body: '{ "query": "keyword" }', desc: 'Search tasks' },
    { method: 'POST', path: '/tasks/get', body: '{ "id": "<taskId>" }', desc: 'Get one task' },
    { method: 'POST', path: '/life-events/search', body: '{ "query": "keyword" }', desc: 'Search life events' },
    { method: 'POST', path: '/memo/search', body: '{ "query": "keyword" }', desc: 'Search memos' },
    { method: 'POST', path: '/info-vault/search', body: '{ "query": "keyword" }', desc: 'Search info vault' },
    { method: 'POST', path: '/files/add', body: '{ "messageId": "<chatMessageId>", "fileName": "file.txt", "contentBase64": "..." }', desc: 'Attach a file to a chat message' },
    { method: 'POST', path: '/files/list', body: '{ "messageId": "<chatMessageId>" }', desc: 'List files attached to a chat message' },
] as const;

export const buildWebhookContextMarkdown = ({
    clientFrontendUrl,
    chatMessageId,
}: {
    clientFrontendUrl: string;
    chatMessageId?: string;
}): string => {
    const base = webhookAgentBaseUrl(clientFrontendUrl);
    const messageId = (chatMessageId || '').trim();
    const lines: string[] = [
        '# User webhooks',
        '',
        'Call these HTTP endpoints from this Agent Workspace to search the user account and attach files to this chat message.',
        'Search only for notes, tasks, memos, life events, and info vault. Do not create or update those records.',
        'Do not use cookie auth. Send the token on every request.',
        'Inside this container, `localhost` is the container itself. Use the Base URL below (`host.docker.internal`).',
        'On the host machine the same routes are `http://localhost:3000/api/webhook/*`.',
        '',
        `Base URL: ${base}`,
        'Header: `X-Webhook-Token: <token>`',
        'Alternate header: `Authorization: Bearer <token>`',
        '',
        'Token is also in the environment as `WEBHOOK_TOKEN`. Base URL as `WEBHOOK_BASE_URL`.',
        messageId
            ? `This chat message id is \`${messageId}\` (also \`CHAT_MESSAGE_ID\` in the environment). Use it as \`messageId\` when attaching files.`
            : 'When attaching a file, `messageId` must be a chat message id that belongs to this user.',
        '',
        '## Endpoints',
        '',
    ];
    for (const ep of WEBHOOK_ENDPOINTS) {
        lines.push(`### ${ep.method} ${ep.path}`);
        lines.push(ep.desc);
        if (ep.body) lines.push(`Body JSON: \`${ep.body}\``);
        lines.push('');
    }
    lines.push(
        '## Example: search',
        '',
        '```bash',
        `curl -sS -X POST "$WEBHOOK_BASE_URL/search" \\`,
        '  -H "Content-Type: application/json" \\',
        '  -H "X-Webhook-Token: $WEBHOOK_TOKEN" \\',
        '  -d \'{"query":"password","source":"all"}\'',
        '```',
        '',
        '`source` for `/search` may be `all`, `notes`, `tasks`, `lifeEvents`, `memo`, or `infoVault`.',
        '',
        '## Example: attach a file to this chat message',
        '',
        '```bash',
        `curl -sS -X POST "$WEBHOOK_BASE_URL/files/add" \\`,
        '  -H "Content-Type: application/json" \\',
        '  -H "X-Webhook-Token: $WEBHOOK_TOKEN" \\',
        '  -d "{\\"messageId\\":\\"$CHAT_MESSAGE_ID\\",\\"fileName\\":\\"notes.txt\\",\\"contentBase64\\":\\"$(base64 -w0 notes.txt)\\"}"',
        '```',
        '',
        'Send UTF-8 or binary content as base64. Max 8MB. `messageId` is required.',
        ''
    );
    return `${lines.join('\n')}\n`;
};
