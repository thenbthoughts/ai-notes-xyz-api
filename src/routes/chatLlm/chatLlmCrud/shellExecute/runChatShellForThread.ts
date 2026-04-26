import axios from 'axios';
import mongoose, { HydratedDocument } from 'mongoose';

import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelChatLlmThread } from '../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelUserApiKey } from '../../../../schema/schemaUser/SchemaUserApiKey.schema';
import { ModelChatShellRunGroup } from '../../../../schema/schemaChatLlm/SchemaShellExecute/SchemaChatShellRunGroup.schema';
import { ModelChatShellRunTodo } from '../../../../schema/schemaChatLlm/SchemaShellExecute/SchemaChatShellRunTodo.schema';
import { ModelChatShellGeneratedFile } from '../../../../schema/schemaChatLlm/SchemaShellExecute/SchemaChatShellGeneratedFile.schema';
import { getApiKeyByObject } from '../../../../utils/llm/llmCommonFunc';
import { getLlmConfig } from '../answerMachineV2/helperFunction/answerMachineGetLlmConfig';
import fetchLlmUnified, { Message } from '../../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { putFile, S3Config } from '../../../../utils/upload/uploadFunc';
import type { ChatShellExecuteStrategy } from '../../../../types/typesSchema/typesChatLlm/SchemaChatShellRunTodo.types';
import type { IChatLlmThread } from '../../../../types/typesSchema/typesChatLlm/SchemaChatLlmThread.types';
import type { IChatShellRunGroup } from '../../../../types/typesSchema/typesChatLlm/SchemaChatShellRunGroup.types';
import type IUserApiKey from '../../../../types/typesSchema/typesUser/SchemaUserApiKey.types';
import type { DefaultDateTimeIpAddress } from '../../../../utils/llm/normalizeDateTimeIpAddress';

const SHELL_RUN_LOG = '[runChatShellForThread]';

type ParsedTodo = {
    taskName: string;
    executeStrategyBy: ChatShellExecuteStrategy;
    shellCommand: string;
};

const STRATEGIES: ChatShellExecuteStrategy[] = [
    'llm',
    'shellExecute',
    'browserIntegration',
    'internalKnowledgeAndLlm',
];

/** Planner + shell fallback: steer models away from missing POSIX tools (bc, md5sum) and blocked chaining (| ; &). */
const SHELL_EXECUTE_COMMAND_GUIDANCE =
    'SHELL COMMAND STYLE (every shellExecute shellCommand):\n' +
    '1) FIRST prefer Node.js as ONE line: node -e "..." using built-in modules (e.g. require("crypto") for hashes; JavaScript arithmetic for products/sums).\n' +
    '2) Do NOT rely on bc, md5sum, openssl, etc. — they are often absent in the shell sandbox. Do NOT use `|`, `;`, or `&` (the server rejects those characters).\n' +
    '3) If you truly need an npm library: plan TWO shellExecute steps in order — (a) a single line: npm install <package> --no-save  (b) a later step: node -e "..." that require()s that package. Each line must stay valid without pipes or command chaining.\n';

type LlmConfigNonNull = NonNullable<Awaited<ReturnType<typeof getLlmConfig>>>;

type ShellRunCtx = {
    threadId: mongoose.Types.ObjectId;
    username: string;
    actionDatetimeObj: DefaultDateTimeIpAddress;
    thread: HydratedDocument<IChatLlmThread>;
    userKeyDoc: HydratedDocument<IUserApiKey>;
    keys: ReturnType<typeof getApiKeyByObject>;
    apiBase: string;
    token: string;
    group: HydratedDocument<IChatShellRunGroup>;
    failGroup: (msg: string) => Promise<void>;
    convo: string;
    latestUserText: string;
    llmConfig: LlmConfigNonNull;
    todos: ParsedTodo[];
    todoDocs: mongoose.Types.ObjectId[];
    nonShellSummary: string;
    shellLines: string[];
    fileLines: string[];
    storageType: 's3' | 'gridfs';
    s3Config: S3Config | undefined;
};

function logStep(stepNum: number, message: string, detail?: Record<string, unknown>) {
    const label = `step${stepNum}`;
    if (detail !== undefined) {
        console.log(SHELL_RUN_LOG, label, message, detail);
    } else {
        console.log(SHELL_RUN_LOG, label, message);
    }
}

function isValidStrategy(s: string): s is ChatShellExecuteStrategy {
    return (STRATEGIES as string[]).includes(s);
}

function sanitizeShellCommand(raw: string): string | null {
    const cmd = raw.trim();
    if (!cmd) {
        return null;
    }
    return cmd;
}

function looksComputeLike(text: string): boolean {
    return /\b(md5|sha\d*|hash|checksum|base64|encode|decode|openssl|certutil|crc|digest)\b/i.test(text);
}

function hasRunnableShellTodo(todos: ParsedTodo[]): boolean {
    return todos.some(
        (t) => t.executeStrategyBy === 'shellExecute' && Boolean(sanitizeShellCommand(t.shellCommand || '')),
    );
}

async function tryGenerateShellTodoWithLlm(params: {
    llmConfig: LlmConfigNonNull;
    latestUserText: string;
    convo: string;
    extraDirective: string;
}): Promise<ParsedTodo | null> {
    const { llmConfig, latestUserText, convo, extraDirective } = params;
    console.log(SHELL_RUN_LOG, 'tryGenerateShellTodoWithLlm', 'start', { extraDirectivePreview: extraDirective.slice(0, 120) });
    const fbMessages: Message[] = [
        {
            role: 'system',
            content: `You output exactly one JSON object with keys "taskName" and "shellCommand" only. No markdown, no code fences.
The shell server runs one command string with no stdin pipe chaining. shellCommand must be a SINGLE line.
Forbidden characters inside shellCommand: backtick, dollar sign, pipe |, semicolon ;, ampersand &, newlines.
You MAY use parentheses and angle brackets for typical CLI tools (e.g. node -e, python -c, simple redirects).
${SHELL_EXECUTE_COMMAND_GUIDANCE}
Prefer a portable approach when possible: e.g. Node one-liner for MD5 of a literal string:
node -e "console.log(require('crypto').createHash('md5').update('YOUR_STRING').digest('hex'))"
Replace YOUR_STRING with the actual UTF-8 string from the user request (escape quotes inside the string safely).
If the user asks for a file hash and a path is given under ai-notes-xyz-shell-files, use certutil -hashfile on Windows or openssl dgst on POSIX — pick one style; assume a Windows-style host if unsure.
${extraDirective}`,
        },
        {
            role: 'user',
            content: `LATEST USER MESSAGE:\n${latestUserText}\n\nTHREAD CONTEXT (truncated):\n${convo.slice(-3500)}`,
        },
    ];

    const fb = await fetchLlmUnified({
        provider: llmConfig.provider,
        apiKey: llmConfig.apiKey,
        apiEndpoint: llmConfig.apiEndpoint,
        model: llmConfig.model,
        messages: fbMessages,
        temperature: 0.15,
        maxTokens: 512,
        headersExtra: llmConfig.customHeaders,
        responseFormat: 'json_object',
    });

    if (!fb.success || !fb.content) {
        console.log(SHELL_RUN_LOG, 'tryGenerateShellTodoWithLlm', 'LLM call failed or empty', {
            success: fb.success,
            hasContent: Boolean(fb.content),
        });
        return null;
    }
    let obj: unknown;
    try {
        obj = JSON.parse(fb.content.trim());
    } catch {
        console.log(SHELL_RUN_LOG, 'tryGenerateShellTodoWithLlm', 'JSON.parse failed', {
            contentPreview: fb.content.trim().slice(0, 200),
        });
        return null;
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        console.log(SHELL_RUN_LOG, 'tryGenerateShellTodoWithLlm', 'parsed value not a plain object');
        return null;
    }
    const o = obj as Record<string, unknown>;
    const taskName = typeof o.taskName === 'string' ? o.taskName.trim() : '';
    const shellCommand = typeof o.shellCommand === 'string' ? o.shellCommand.trim() : '';
    const safe = sanitizeShellCommand(shellCommand);
    if (!taskName || !safe) {
        console.log(SHELL_RUN_LOG, 'tryGenerateShellTodoWithLlm', 'reject after sanitize', {
            hasTaskName: Boolean(taskName),
            hasSafeCommand: Boolean(safe),
        });
        return null;
    }
    console.log(SHELL_RUN_LOG, 'tryGenerateShellTodoWithLlm', 'success', { taskName, shellCommandPreview: safe.slice(0, 200) });
    return {
        taskName,
        executeStrategyBy: 'shellExecute',
        shellCommand: safe,
    };
}

function extractJsonArray(text: string): unknown[] | null {
    const trimmed = text.trim();
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fence ? fence[1].trim() : trimmed;
    try {
        const parsed = JSON.parse(candidate);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        try {
            const start = candidate.indexOf('[');
            const end = candidate.lastIndexOf(']');
            if (start >= 0 && end > start) {
                const parsed = JSON.parse(candidate.slice(start, end + 1));
                return Array.isArray(parsed) ? parsed : null;
            }
        } catch {
            return null;
        }
        return null;
    }
}

function normalizeTodos(raw: unknown[]): ParsedTodo[] {
    const out: ParsedTodo[] = [];
    for (const item of raw.slice(0, 8)) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const o = item as Record<string, unknown>;
        const taskName = typeof o.taskName === 'string' ? o.taskName.trim() : '';
        const strat = typeof o.executeStrategyBy === 'string' ? o.executeStrategyBy.trim() : '';
        const shellCommand = typeof o.shellCommand === 'string' ? o.shellCommand : '';
        if (!taskName || !isValidStrategy(strat)) continue;
        out.push({
            taskName,
            executeStrategyBy: strat,
            shellCommand,
        });
    }
    return out;
}

function extractShellRelativePaths(text: string): string[] {
    const found = new Set<string>();
    const re = /[^\s"'<>]+ai-notes-xyz-shell-files[^\s"'<>]+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        let p = m[0].replace(/^[`"'(,]+|[\)`"',.;:]+$/g, '');
        p = p.replace(/\\/g, '/');
        if (!p.includes('..')) {
            found.add(p);
        }
    }
    return [...found];
}

async function shellStep1LoadThreadAndKeys(params: {
    threadId: mongoose.Types.ObjectId;
    username: string;
}): Promise<
    | { ok: true; data: Pick<ShellRunCtx, 'thread' | 'userKeyDoc' | 'keys' | 'apiBase' | 'token'> }
    | { ok: false; error: string }
> {
    const { threadId, username } = params;
    logStep(1, 'load thread and API keys', { threadId: String(threadId), username });

    const thread = await ModelChatLlmThread.findOne({ _id: threadId, username });
    if (!thread) {
        logStep(1, 'thread not found');
        return { ok: false, error: 'Thread not found' };
    }

    const userKeyDoc = await ModelUserApiKey.findOne({ username });
    if (!userKeyDoc) {
        logStep(1, 'User API keys doc missing');
        return { ok: false, error: 'User API keys not found' };
    }

    const keys = getApiKeyByObject(userKeyDoc);
    if (!keys.shellEngineValid || !keys.shellEngineUrl || !keys.shellEngineToken) {
        logStep(1, 'shell engine not configured on keys', {
            shellEngineValid: keys.shellEngineValid,
            hasUrl: Boolean(keys.shellEngineUrl),
            hasToken: Boolean(keys.shellEngineToken),
        });
        return {
            ok: false,
            error: 'Shell execute is enabled but Shell service is not configured in API Keys.',
        };
    }

    const shellOrigin = keys.shellEngineUrl.replace(/\/+$/, '');
    const apiBase = `${shellOrigin}/api`;
    const token = keys.shellEngineToken;
    logStep(1, 'shell HTTP target ready', { apiBase, tokenLength: token.length });

    return {
        ok: true,
        data: {
            thread: thread as HydratedDocument<IChatLlmThread>,
            userKeyDoc: userKeyDoc as HydratedDocument<IUserApiKey>,
            keys,
            apiBase,
            token,
        },
    };
}

async function shellStep2CreateRunGroup(params: {
    threadId: mongoose.Types.ObjectId;
    username: string;
}): Promise<{
    ok: true;
    data: Pick<ShellRunCtx, 'group' | 'failGroup'>;
}> {
    const { threadId, username } = params;
    logStep(2, 'create ChatShellRunGroup');

    const created = await ModelChatShellRunGroup.create({
        threadId,
        username,
        status: 'running',
        errorReason: '',
        createdAtUtc: new Date(),
        updatedAtUtc: new Date(),
    });
    const group = (Array.isArray(created) ? created[0] : created) as HydratedDocument<IChatShellRunGroup>;

    const failGroup = async (msg: string) => {
        logStep(2, 'failGroup', { groupId: String(group._id), msg });
        await ModelChatShellRunGroup.findByIdAndUpdate(group._id, {
            $set: { status: 'error', errorReason: msg, updatedAtUtc: new Date() },
        });
    };

    logStep(2, 'group created', { groupId: String(group._id) });
    return { ok: true, data: { group, failGroup } };
}

async function shellStep3LoadConversation(params: {
    threadId: mongoose.Types.ObjectId;
    username: string;
}): Promise<{ ok: true; data: Pick<ShellRunCtx, 'convo' | 'latestUserText'> }> {
    const { threadId, username } = params;
    logStep(3, 'load recent messages');

    const recent = await ModelChatLlm.find({
        threadId,
        username,
        type: 'text',
    })
        .sort({ createdAtUtc: -1 })
        .limit(18)
        .lean();

    logStep(3, 'recent messages loaded', { count: recent.length });

    const chronological = [...recent].reverse();
    const convo = chronological
        .map((m) => `${m.isAi ? 'AI' : 'User'}: ${(m.content || '').slice(0, 4000)}`)
        .join('\n');

    const lastUser = await ModelChatLlm.findOne({
        threadId,
        username,
        isAi: false,
        type: 'text',
    })
        .sort({ createdAtUtc: -1 })
        .lean();

    const latestUserText = lastUser?.content?.trim() || '';
    logStep(3, 'convo + latest user', {
        convoLength: convo.length,
        latestUserTextLength: latestUserText.length,
        latestUserPreview: latestUserText.slice(0, 200),
    });

    return { ok: true, data: { convo, latestUserText } };
}

async function shellStep4ResolveLlmConfig(params: {
    threadId: mongoose.Types.ObjectId;
    failGroup: ShellRunCtx['failGroup'];
}): Promise<{ ok: true; data: Pick<ShellRunCtx, 'llmConfig'> } | { ok: false; error: string }> {
    const { threadId, failGroup } = params;
    logStep(4, 'getLlmConfig');

    const llmConfig = await getLlmConfig({ threadId });
    if (!llmConfig) {
        logStep(4, 'getLlmConfig returned null');
        await failGroup('No LLM configuration for decomposition');
        return { ok: false, error: 'Could not load LLM configuration for shell planning.' };
    }

    logStep(4, 'LLM config loaded', { provider: llmConfig.provider, model: llmConfig.model });
    return { ok: true, data: { llmConfig } };
}

async function shellStep5BuildTodoPlan(params: {
    llmConfig: LlmConfigNonNull;
    convo: string;
    latestUserText: string;
}): Promise<{ ok: true; data: Pick<ShellRunCtx, 'todos'> }> {
    const { llmConfig, convo, latestUserText } = params;
    logStep(5, 'planner fetchLlmUnified');

    const planMessages: Message[] = [
        {
            role: 'system',
            content:
                'You break down the user request into a small ordered list of tasks. Reply with ONLY a JSON array (no markdown), max 6 objects. Each object: {"taskName": string, "executeStrategyBy": one of "llm","shellExecute","browserIntegration","internalKnowledgeAndLlm", "shellCommand": string}.\n' +
                'CRITICAL routing rules for this chat (Execute shell is ON):\n' +
                '- If the user asks for hashes (MD5/SHA), checksums, encodings, small deterministic computation, file metadata/size, or anything verifiable with a short CLI command, you MUST set executeStrategyBy to "shellExecute" and provide a non-empty single-line shellCommand.\n' +
                '- Use "internalKnowledgeAndLlm" or "llm" ONLY for pure reasoning that cannot be answered or verified by a one-line shell command.\n' +
                '- Use "browserIntegration" only when the user explicitly needs a web browser.\n' +
                '- Prefer 1 shellExecute step when possible; at most 2 shellExecute steps.\n' +
                'When executeStrategyBy is not "shellExecute", shellCommand must be an empty string.\n' +
                SHELL_EXECUTE_COMMAND_GUIDANCE,
        },
        {
            role: 'user',
            content: `THREAD CONTEXT:\n${convo}\n\nLATEST USER MESSAGE:\n${latestUserText}\n\nReturn JSON array now.`,
        },
    ];

    const planLlm = await fetchLlmUnified({
        provider: llmConfig.provider,
        apiKey: llmConfig.apiKey,
        apiEndpoint: llmConfig.apiEndpoint,
        model: llmConfig.model,
        messages: planMessages,
        temperature: 0.3,
        maxTokens: 2048,
        headersExtra: llmConfig.customHeaders,
    });

    logStep(5, 'planner LLM returned', {
        success: planLlm.success,
        contentLength: planLlm.content?.length ?? 0,
        contentPreview: planLlm.content?.trim().slice(0, 300),
    });

    let todos: ParsedTodo[] = [];
    if (planLlm.success && planLlm.content) {
        const arr = extractJsonArray(planLlm.content);
        if (arr) {
            todos = normalizeTodos(arr);
            logStep(5, 'extracted JSON array from planner', { rawLength: arr.length, normalizedCount: todos.length });
        } else {
            logStep(5, 'extractJsonArray returned null');
        }
    } else {
        logStep(5, 'skipped parse — planner missing success/content');
    }

    logStep(5, 'todos after planner', {
        count: todos.length,
        strategies: todos.map((t) => t.executeStrategyBy),
        hasRunnableShellTodo: hasRunnableShellTodo(todos),
    });

    if (!hasRunnableShellTodo(todos)) {
        logStep(5, 'fallback LLM first pass');
        let injected = await tryGenerateShellTodoWithLlm({
            llmConfig,
            latestUserText,
            convo,
            extraDirective: 'If the user request can be satisfied with one safe shell command, you must provide it.',
        });
        logStep(5, 'first fallback result', { injected: Boolean(injected) });
        if (!injected && looksComputeLike(latestUserText)) {
            logStep(5, 'fallback LLM second pass (compute-like)');
            injected = await tryGenerateShellTodoWithLlm({
                llmConfig,
                latestUserText,
                convo,
                extraDirective:
                    'The user message clearly implies a CLI hash, checksum, encoding, or similar deterministic computation. You MUST output a single-line shellCommand that performs it (e.g. Node crypto one-liner for string MD5).',
            });
            logStep(5, 'second fallback result', { injected: Boolean(injected) });
        }
        if (injected) {
            todos = [injected, ...todos];
            logStep(5, 'prepended injected shell todo', { newCount: todos.length });
        }
    } else {
        logStep(5, 'runnable shell todo present — skip fallback');
    }

    if (todos.length === 0) {
        logStep(5, 'default internalKnowledgeAndLlm todo');
        todos = [
            {
                taskName: 'Clarify and answer from context',
                executeStrategyBy: 'internalKnowledgeAndLlm',
                shellCommand: '',
            },
        ];
    }

    logStep(5, 'final todo list', {
        count: todos.length,
        items: todos.map((t) => ({
            taskName: t.taskName,
            executeStrategyBy: t.executeStrategyBy,
            shellCmdLen: (t.shellCommand || '').length,
        })),
    });

    return { ok: true, data: { todos } };
}

async function shellStep6PersistTodos(params: {
    todos: ParsedTodo[];
    group: HydratedDocument<IChatShellRunGroup>;
    threadId: mongoose.Types.ObjectId;
    username: string;
}): Promise<{ ok: true; data: Pick<ShellRunCtx, 'todoDocs'> }> {
    const { todos, group, threadId, username } = params;
    logStep(6, 'create ChatShellRunTodo rows');

    const todoDocs: mongoose.Types.ObjectId[] = [];
    for (let i = 0; i < todos.length; i++) {
        const t = todos[i];
        logStep(6, 'creating todo', { index: i, taskName: t.taskName, executeStrategyBy: t.executeStrategyBy });
        const doc = await ModelChatShellRunTodo.create({
            chatShellRunGroupId: group._id,
            threadId,
            username,
            executeStrategyBy: t.executeStrategyBy,
            taskName: t.taskName,
            shellCommand: t.shellCommand,
            status: 'pending',
            orderIndex: i,
            stdout: '',
            stderr: '',
            exitCode: null,
            createdAtUtc: new Date(),
            updatedAtUtc: new Date(),
        });
        todoDocs.push(doc._id as mongoose.Types.ObjectId);
    }
    logStep(6, 'all todo rows created', { todoDocIds: todoDocs.map(String) });
    return { ok: true, data: { todoDocs } };
}

async function shellStep7SummarizeNonShellTodos(params: {
    todos: ParsedTodo[];
    llmConfig: LlmConfigNonNull;
    convo: string;
}): Promise<{ ok: true; data: Pick<ShellRunCtx, 'nonShellSummary'> }> {
    const { todos, llmConfig, convo } = params;
    const nonShell = todos.filter((t) => t.executeStrategyBy !== 'shellExecute');
    let nonShellSummary = '';

    if (nonShell.length > 0) {
        logStep(7, 'batch fetchLlmUnified for non-shell', { nonShellCount: nonShell.length });
        const batchMessages: Message[] = [
            {
                role: 'system',
                content:
                    'You answer short research-style subtasks based on the thread. Reply with plain text bullet list only.',
            },
            {
                role: 'user',
                content: `CONTEXT:\n${convo}\n\nSUBTASKS:\n${nonShell
                    .map((t, i) => `${i + 1}. [${t.executeStrategyBy}] ${t.taskName}`)
                    .join('\n')}\n\nProvide concise bullets.`,
            },
        ];
        const batchLlm = await fetchLlmUnified({
            provider: llmConfig.provider,
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: llmConfig.model,
            messages: batchMessages,
            temperature: 0.4,
            maxTokens: 2048,
            headersExtra: llmConfig.customHeaders,
        });
        nonShellSummary = batchLlm.success && batchLlm.content ? batchLlm.content.trim() : '(subtask LLM call failed)';
        logStep(7, 'batch LLM done', { success: batchLlm.success, summaryLength: nonShellSummary.length });
    } else {
        logStep(7, 'no non-shell todos — skip');
    }

    return { ok: true, data: { nonShellSummary } };
}

function shellStep8BuildFileStorageConfig(params: {
    userKeyDoc: HydratedDocument<IUserApiKey>;
    keys: ReturnType<typeof getApiKeyByObject>;
}): { ok: true; data: Pick<ShellRunCtx, 'storageType' | 's3Config'> } {
    const { userKeyDoc, keys } = params;
    logStep(8, 'file storage for shell imports');

    const storageType = userKeyDoc.fileStorageType === 's3' ? 's3' : 'gridfs';
    const s3Config: S3Config | undefined =
        storageType === 's3'
            ? {
                  region: keys.apiKeyS3Region || 'auto',
                  endpoint: keys.apiKeyS3Endpoint || '',
                  accessKeyId: keys.apiKeyS3AccessKeyId || '',
                  secretAccessKey: keys.apiKeyS3SecretAccessKey || '',
                  bucketName: keys.apiKeyS3BucketName || '',
              }
            : undefined;

    logStep(8, 'storage resolved', { storageType });
    return { ok: true, data: { storageType, s3Config } };
}

async function shellStep9ExecuteTodosAndImportFiles(params: {
    todos: ParsedTodo[];
    todoDocs: mongoose.Types.ObjectId[];
    apiBase: string;
    token: string;
    group: HydratedDocument<IChatShellRunGroup>;
    threadId: mongoose.Types.ObjectId;
    username: string;
    storageType: 's3' | 'gridfs';
    s3Config: S3Config | undefined;
}): Promise<{ ok: true; data: Pick<ShellRunCtx, 'shellLines' | 'fileLines'> }> {
    const { todos, todoDocs, apiBase, token, group, threadId, username, storageType, s3Config } = params;

    logStep(9, 'execute todo loop start', { todoCount: todos.length });
    const shellLines: string[] = [];
    const fileLines: string[] = [];

    for (let i = 0; i < todos.length; i++) {
        const t = todos[i];
        const todoId = todoDocs[i];

        logStep(9, 'todo iteration', {
            index: i,
            todoId: String(todoId),
            executeStrategyBy: t.executeStrategyBy,
            taskName: t.taskName,
        });

        if (t.executeStrategyBy !== 'shellExecute') {
            logStep(9, 'mark skipped', { index: i });
            await ModelChatShellRunTodo.findByIdAndUpdate(todoId, {
                $set: { status: 'skipped', updatedAtUtc: new Date() },
            });
            continue;
        }

        const safeCmd = sanitizeShellCommand(t.shellCommand);
        if (!safeCmd) {
            logStep(9, 'rejected by sanitize', { index: i });
            await ModelChatShellRunTodo.findByIdAndUpdate(todoId, {
                $set: {
                    status: 'failed',
                    stderr: 'Invalid or unsafe shell command',
                    updatedAtUtc: new Date(),
                },
            });
            shellLines.push(`- **${t.taskName}**: rejected command`);
            continue;
        }

        logStep(9, 'POST execute', { index: i, url: `${apiBase}/shell-engine/run-shell/execute`, commandPreview: safeCmd.slice(0, 200) });

        await ModelChatShellRunTodo.findByIdAndUpdate(todoId, {
            $set: { status: 'running', updatedAtUtc: new Date() },
        });

        try {
            const execRes = await axios.post(
                `${apiBase}/shell-engine/run-shell/execute`,
                { command: safeCmd, timeoutMs: 60_000 },
                {
                    timeout: 90_000,
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Token': token,
                    },
                    validateStatus: () => true,
                }
            );

            logStep(9, 'execute HTTP response', { index: i, httpStatus: execRes.status });

            const body = execRes.data as Record<string, unknown>;
            const stdout = typeof body.stdout === 'string' ? body.stdout : '';
            const stderr = typeof body.stderr === 'string' ? body.stderr : '';
            const exitCode = typeof body.exitCode === 'number' ? body.exitCode : null;

            await ModelChatShellRunTodo.findByIdAndUpdate(todoId, {
                $set: {
                    status: execRes.status === 200 ? 'done' : 'failed',
                    stdout: stdout.slice(0, 50_000),
                    stderr: stderr.slice(0, 50_000),
                    exitCode,
                    updatedAtUtc: new Date(),
                },
            });

            logStep(9, 'todo DB updated after execute', {
                index: i,
                exitCode,
                stdoutLen: stdout.length,
                stderrLen: stderr.length,
            });

            shellLines.push(
                `- **${t.taskName}** (exit ${exitCode ?? 'n/a'}):\n  \`${safeCmd}\`\n  stdout: ${stdout.slice(0, 1500)}${stdout.length > 1500 ? '…' : ''}`,
            );

            const combined = `${stdout}\n${stderr}`;
            const paths = extractShellRelativePaths(combined);
            logStep(9, 'path scan', { pathCount: paths.length, paths });

            for (const rel of paths) {
                try {
                    logStep(9, 'file/read GET', { relativePath: rel });
                    const fileRes = await axios.get(`${apiBase}/shell-engine/file/read`, {
                        params: { relativePath: rel },
                        responseType: 'arraybuffer',
                        timeout: 60_000,
                        headers: { 'X-API-Token': token },
                        validateStatus: () => true,
                    });
                    logStep(9, 'file/read response', { relativePath: rel, httpStatus: fileRes.status });
                    if (fileRes.status !== 200 || !fileRes.data) {
                        logStep(9, 'skip file import', { relativePath: rel });
                        continue;
                    }
                    const buf = Buffer.from(fileRes.data as ArrayBuffer);
                    const ct =
                        (typeof fileRes.headers['content-type'] === 'string'
                            ? fileRes.headers['content-type']
                            : 'application/octet-stream') || 'application/octet-stream';
                    const baseName = rel.split('/').pop() || `shell-file-${todoId}`;
                    const storedName = `shell/${String(group._id)}/${baseName}`;

                    const put = await putFile({
                        fileName: storedName,
                        fileContent: buf,
                        contentType: ct,
                        storageType,
                        s3Config,
                        metadata: {
                            source: 'chatShellRun',
                            threadId: String(threadId),
                            groupId: String(group._id),
                        },
                    });

                    logStep(9, 'putFile', { relativePath: rel, success: put.success, fileId: put.fileId });
                    if (!put.success || !put.fileId) {
                        continue;
                    }

                    let summary = `[binary ${buf.length} bytes]`;
                    if (ct.startsWith('text/') || ct.includes('json') || ct.includes('xml')) {
                        summary = buf.toString('utf8').slice(0, 2000);
                        if (buf.toString('utf8').length > 2000) summary += '…';
                    }

                    await ModelChatShellGeneratedFile.create({
                        chatShellRunGroupId: group._id,
                        threadId,
                        username,
                        todoId,
                        relativePath: rel,
                        storedFileUrl: put.fileId,
                        fileName: baseName,
                        mimeType: ct,
                        summary,
                        createdAtUtc: new Date(),
                    });

                    fileLines.push(`- ${baseName} (from shell path \`${rel}\`) — file id: \`${put.fileId}\``);
                    logStep(9, 'ChatShellGeneratedFile created', { baseName, fileId: put.fileId });
                } catch (fileErr) {
                    logStep(9, 'file import catch', { relativePath: rel, err: fileErr });
                    console.error('shell file import failed', fileErr);
                }
            }
        } catch (cmdErr) {
            logStep(9, 'axios execute catch', { index: i, err: cmdErr });
            console.error('shell execute failed', cmdErr);
            await ModelChatShellRunTodo.findByIdAndUpdate(todoId, {
                $set: {
                    status: 'failed',
                    stderr: cmdErr instanceof Error ? cmdErr.message : 'execute error',
                    updatedAtUtc: new Date(),
                },
            });
            shellLines.push(`- **${t.taskName}**: command failed`);
        }
    }

    logStep(9, 'execute loop finished', { shellLineCount: shellLines.length, fileLineCount: fileLines.length });
    return { ok: true, data: { shellLines, fileLines } };
}

async function shellStep10WriteSummaryAndCompleteGroup(params: {
    threadId: mongoose.Types.ObjectId;
    username: string;
    actionDatetimeObj: DefaultDateTimeIpAddress;
    group: HydratedDocument<IChatShellRunGroup>;
    nonShellSummary: string;
    shellLines: string[];
    fileLines: string[];
}): Promise<{ ok: true }> {
    const { threadId, username, actionDatetimeObj, group, nonShellSummary, shellLines, fileLines } = params;

    logStep(10, 'build summary message');
    const summaryBody = [
        '### Shell run',
        '',
        '**Plan (other strategies)**',
        nonShellSummary || '(none)',
        '',
        '**Shell commands**',
        shellLines.length ? shellLines.join('\n') : '(none)',
        '',
        '**Imported files**',
        fileLines.length ? fileLines.join('\n') : '(none)',
    ].join('\n');

    logStep(10, 'ModelChatLlm.create shell-run', { summaryBodyLength: summaryBody.length });
    await ModelChatLlm.create({
        type: 'text',
        content: summaryBody,
        username,
        threadId,
        isAi: true,
        tags: ['shell-run'],
        ...actionDatetimeObj,
    });

    await ModelChatShellRunGroup.findByIdAndUpdate(group._id, {
        $set: { status: 'completed', updatedAtUtc: new Date() },
    });
    logStep(10, 'group completed', { groupId: String(group._id) });
    return { ok: true };
}

export async function runChatShellForThread(params: {
    threadId: mongoose.Types.ObjectId;
    username: string;
    actionDatetimeObj: DefaultDateTimeIpAddress;
}): Promise<{ success: true } | { success: false; error: string }> {
    const { threadId, username, actionDatetimeObj } = params;
    logStep(0, 'enter', { threadId: String(threadId), username });

    const s1 = await shellStep1LoadThreadAndKeys({ threadId, username });
    if (!s1.ok) {
        return { success: false, error: s1.error };
    }

    const s2 = await shellStep2CreateRunGroup({ threadId, username });
    const { group, failGroup } = s2.data;

    try {
        const s3 = await shellStep3LoadConversation({ threadId, username });
        const s4 = await shellStep4ResolveLlmConfig({ threadId, failGroup });
        if (!s4.ok) {
            return { success: false, error: s4.error };
        }

        const merged: ShellRunCtx = {
            threadId,
            username,
            actionDatetimeObj,
            ...s1.data,
            ...s2.data,
            ...s3.data,
            ...s4.data,
            todos: [],
            todoDocs: [],
            nonShellSummary: '',
            shellLines: [],
            fileLines: [],
            storageType: 'gridfs',
            s3Config: undefined,
        };

        const s5 = await shellStep5BuildTodoPlan({
            llmConfig: merged.llmConfig,
            convo: merged.convo,
            latestUserText: merged.latestUserText,
        });
        merged.todos = s5.data.todos;

        const s6 = await shellStep6PersistTodos({
            todos: merged.todos,
            group: merged.group,
            threadId: merged.threadId,
            username: merged.username,
        });
        merged.todoDocs = s6.data.todoDocs;

        const s7 = await shellStep7SummarizeNonShellTodos({
            todos: merged.todos,
            llmConfig: merged.llmConfig,
            convo: merged.convo,
        });
        merged.nonShellSummary = s7.data.nonShellSummary;

        const s8 = shellStep8BuildFileStorageConfig({
            userKeyDoc: merged.userKeyDoc,
            keys: merged.keys,
        });
        merged.storageType = s8.data.storageType;
        merged.s3Config = s8.data.s3Config;

        const s9 = await shellStep9ExecuteTodosAndImportFiles({
            todos: merged.todos,
            todoDocs: merged.todoDocs,
            apiBase: merged.apiBase,
            token: merged.token,
            group: merged.group,
            threadId: merged.threadId,
            username: merged.username,
            storageType: merged.storageType,
            s3Config: merged.s3Config,
        });
        merged.shellLines = s9.data.shellLines;
        merged.fileLines = s9.data.fileLines;

        await shellStep10WriteSummaryAndCompleteGroup({
            threadId: merged.threadId,
            username: merged.username,
            actionDatetimeObj: merged.actionDatetimeObj,
            group: merged.group,
            nonShellSummary: merged.nonShellSummary,
            shellLines: merged.shellLines,
            fileLines: merged.fileLines,
        });

        return { success: true };
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Shell run failed';
        logStep(0, 'catch', { msg, err: e });
        await failGroup(msg);
        return { success: false, error: msg };
    }
}
