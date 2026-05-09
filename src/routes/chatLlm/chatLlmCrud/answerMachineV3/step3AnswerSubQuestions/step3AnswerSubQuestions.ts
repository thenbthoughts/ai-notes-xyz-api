import mongoose from 'mongoose';
import { NodeHtmlMarkdown } from 'node-html-markdown';

import { ModelAnswerMachineRequestV3 } from '../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineRequestV3.schema';
import { ModelAnswerMachineSubQuestionV3 } from '../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineSubQuestionV3.schema';
import { ModelChatLlm } from '../../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelGlobalSearch } from '../../../../../schema/schemaGlobalSearch/SchemaGlobalSearch.schema';
import { ModelTask } from '../../../../../schema/schemaTask/SchemaTask.schema';
import { ModelNotes } from '../../../../../schema/schemaNotes/SchemaNotes.schema';
import { ModelLifeEvents } from '../../../../../schema/schemaLifeEvents/SchemaLifeEvents.schema';
import { ModelInfoVault } from '../../../../../schema/schemaInfoVault/SchemaInfoVault.schema';
import { ModelMemoNote } from '../../../../../schema/schemaMemo/SchemaMemoNote.schema';
import { IChatLlm } from '../../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types';
import fetchLlmUnified, { Message } from '../../../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { trackAnswerMachineTokens } from '../../answerMachineV2/helperFunction/tokenTracking';
import { getLlmConfig, LlmConfig } from '../../answerMachineV2/helperFunction/answerMachineGetLlmConfig';
import { executeAnswerMachineShellCommand } from '../../shellExecute/runChatShellForThread';
import { AnswerMachineKbKnowledgeTypeV3 } from '../../../../../types/typesSchema/typesChatLlm/typesAnswerMachine/SchemaAnswerMachineSubQuestionV3.types';

// --- KB: map logical slices to globalSearch collectionName values ---
function kbTypesToGlobalSearchCollections(types: AnswerMachineKbKnowledgeTypeV3[]): string[] {
    const set = new Set<string>();
    for (const t of types) {
        if (t === 'notes') set.add('notes');
        else if (t === 'tasks') set.add('tasks');
        else if (t === 'lifeEvents') set.add('lifeEvents');
        else if (t === 'infoVault') set.add('infoVault');
        else if (t === 'memoNotes') set.add('memoNotes');
    }
    return Array.from(set);
}

const MEMO_INLINE_BODY_MAX = 12000;

interface RelevantContextResponse {
    relevantItems: {
        entityId: string;
        relevanceScore: number;
        relevanceReason: string;
    }[];
}

async function getConversationContextInline(threadId: mongoose.Types.ObjectId, username: string): Promise<string> {
    const lastMessages = (await ModelChatLlm.aggregate([
        { $match: { threadId, username, type: 'text' } },
        { $sort: { createdAtUtc: -1 } },
        { $limit: 10 },
        { $sort: { createdAtUtc: 1 } },
    ])) as IChatLlm[];

    return lastMessages
        .map((msg) => msg.content)
        .filter((c) => typeof c === 'string' && c.trim().length > 0)
        .join('\n')
        .trim();
}

async function generateKeywordsInline(
    question: string,
    llmConfig: LlmConfig,
    threadId: mongoose.Types.ObjectId,
    username: string,
    abortSignal?: AbortSignal
): Promise<string[]> {
    const llmMessages: Message[] = [
        {
            role: 'system',
            content:
                'You extract keywords. Return JSON {"keywords": ["..."]} with ~10 short keywords (1-3 words each).',
        },
        { role: 'user', content: `Question:\n${question}` },
    ];

    const llmResult = await fetchLlmUnified({
        provider: llmConfig.provider,
        apiKey: llmConfig.apiKey,
        apiEndpoint: llmConfig.apiEndpoint,
        model: llmConfig.model,
        messages: llmMessages,
        temperature: 0.7,
        maxTokens: 2048,
        responseFormat: 'json_object',
        headersExtra: llmConfig.customHeaders,
        abortSignal,
    });

    if (!llmResult.success || !llmResult.content) {
        return [];
    }

    try {
        await trackAnswerMachineTokens(threadId, llmResult.usageStats, username, 'sub_question_answer');
    } catch {
        /* empty */
    }

    try {
        const parsed = JSON.parse(llmResult.content) as { keywords?: string[] };
        const keywords = Array.isArray(parsed.keywords) ? parsed.keywords : [];
        return keywords
            .filter((k) => typeof k === 'string' && k.trim())
            .map((k) => k.trim())
            .slice(0, 10);
    } catch {
        return [];
    }
}

async function searchContextIdsFiltered(
    keywords: string[],
    username: string,
    allowedCollections: string[],
    abortSignal?: AbortSignal
): Promise<
    Array<{
        entityId: mongoose.Types.ObjectId;
        collectionName: string;
        text?: string;
        updatedAtUtc?: Date;
    }>
> {
    if (keywords.length === 0 || allowedCollections.length === 0) {
        return [];
    }

    const searchQueryLower = keywords.map((k) => k.toLowerCase().trim()).filter((k) => k.length >= 1);
    if (searchQueryLower.length === 0) return [];

    const searchQueryOrConditions = searchQueryLower.map((item) => ({
        text: { $regex: item, $options: 'i' },
    }));

    type SearchHit = {
        entityId: mongoose.Types.ObjectId;
        collectionName: string;
        text?: string;
        updatedAtUtc?: Date;
    };

    return (await ModelGlobalSearch.aggregate([
        {
            $match: {
                username,
                collectionName: { $in: allowedCollections },
            },
        },
        { $sort: { updatedAtUtc: -1 } },
        { $match: { $or: searchQueryOrConditions } },
        { $sort: { updatedAtUtc: -1 } },
        { $limit: 20 },
    ])) as SearchHit[];
}

async function scoreContextReferencesInline(
    searchResults: Array<{
        entityId: mongoose.Types.ObjectId;
        collectionName: string;
        text?: string;
        updatedAtUtc?: Date;
    }>,
    keywords: string[],
    threadId: mongoose.Types.ObjectId,
    username: string,
    llmConfig: LlmConfig,
    abortSignal?: AbortSignal
): Promise<RelevantContextResponse['relevantItems']> {
    const conversationContext = await getConversationContextInline(threadId, username);
    const questionContext = `Question: ${keywords.join(' ')}`;

    const candidatesStr = searchResults
        .map((result) => {
            const rawText = typeof result.text === 'string' ? result.text : '';
            const compactText = rawText.replace(/\s+/g, ' ').trim().slice(0, 600);
            return [`ID: ${result.entityId.toString()}`, `Collection: ${result.collectionName}`, `Text: ${compactText}`].join(
                '\n'
            );
        })
        .join('\n\n');

    const llmMessages: Message[] = [
        {
            role: 'system',
            content:
                'Evaluate relevance (1-10). JSON only: {"relevantItems":[{"entityId":"...","relevanceScore":7,"relevanceReason":"..."}]} Include only score>=6.',
        },
        {
            role: 'user',
            content: `QUESTION:\n${questionContext}\n\nCONVERSATION CONTEXT:\n${conversationContext}\n\nCANDIDATES:\n${candidatesStr}`,
        },
    ];

    const llmResult = await fetchLlmUnified({
        provider: llmConfig.provider,
        apiKey: llmConfig.apiKey,
        apiEndpoint: llmConfig.apiEndpoint,
        model: llmConfig.model,
        messages: llmMessages,
        temperature: 0.2,
        maxTokens: 4096,
        responseFormat: 'json_object',
        headersExtra: llmConfig.customHeaders,
        abortSignal,
    });

    if (!llmResult.success || !llmResult.content) {
        return [];
    }

    try {
        await trackAnswerMachineTokens(threadId, llmResult.usageStats, username, 'sub_question_answer');
    } catch {
        /* empty */
    }

    try {
        const parsed = JSON.parse(llmResult.content) as RelevantContextResponse;
        if (!parsed?.relevantItems || !Array.isArray(parsed.relevantItems)) return [];

        return parsed.relevantItems.filter(
            (item) =>
                typeof item === 'object' &&
                item !== null &&
                typeof item.entityId === 'string' &&
                typeof item.relevanceScore === 'number' &&
                item.relevanceScore >= 6 &&
                typeof item.relevanceReason === 'string'
        );
    } catch {
        return [];
    }
}

async function getTasksContentInline(contextIds: mongoose.Types.ObjectId[], username: string): Promise<string> {
    const resultTasks = await ModelTask.aggregate([
        { $match: { username, _id: { $in: contextIds } } },
        {
            $lookup: {
                from: 'taskWorkspace',
                localField: 'taskWorkspaceId',
                foreignField: '_id',
                as: 'taskWorkspace',
            },
        },
        {
            $lookup: {
                from: 'taskStatusList',
                localField: 'taskStatusId',
                foreignField: '_id',
                as: 'taskStatusList',
            },
        },
        { $limit: 10 },
    ]);

    if (resultTasks.length === 0) return '';

    let taskStr = 'Below are tasks:\n\n';
    for (let index = 0; index < resultTasks.length; index++) {
        const element = resultTasks[index];
        taskStr += `Task ${index + 1} -> title -> ${element.title || ''}.\n`;
        taskStr += `Task ${index + 1} -> description -> ${element.description || ''}.\n`;
        taskStr += `Task ${index + 1} -> priority -> ${element.priority || ''}.\n`;
        taskStr += `Task ${index + 1} -> isCompleted -> ${element.isCompleted ? 'Yes' : 'No'}.\n`;
        if (element.taskWorkspace?.length >= 1) {
            taskStr += `Task ${index + 1} -> workspace -> ${element.taskWorkspace[0].title}.\n`;
        }
        if (element.taskStatusList?.length >= 1) {
            taskStr += `Task ${index + 1} -> status -> ${element.taskStatusList[0].statusTitle}.\n`;
        }
        taskStr += '\n';
    }
    return `${taskStr}\n\n`;
}

async function getNotesContentInline(contextIds: mongoose.Types.ObjectId[], username: string): Promise<string> {
    const resultNotes = await ModelNotes.aggregate([
        { $match: { username, _id: { $in: contextIds } } },
        {
            $lookup: {
                from: 'notesWorkspace',
                localField: 'notesWorkspaceId',
                foreignField: '_id',
                as: 'notesWorkspaceArr',
            },
        },
        { $limit: 10 },
    ]);

    if (resultNotes.length === 0) return '';

    let noteStr = 'Below are notes:\n\n';
    for (let index = 0; index < resultNotes.length; index++) {
        const element = resultNotes[index];
        noteStr += `Note ${index + 1} -> title -> ${element.title || ''}.\n`;
        if (element.description?.length > 0) {
            noteStr += `Note ${index + 1} -> description -> ${NodeHtmlMarkdown.translate(element.description)}.\n`;
        }
        if (element.notesWorkspaceArr?.length >= 1) {
            noteStr += `Note ${index + 1} -> workspace -> ${element.notesWorkspaceArr[0].title}.\n`;
        }
        noteStr += '\n';
    }
    return `${noteStr}\n\n`;
}

async function getLifeEventsContentInline(contextIds: mongoose.Types.ObjectId[], username: string): Promise<string> {
    const resultLifeEvents = await ModelLifeEvents.aggregate([
        { $match: { username, _id: { $in: contextIds } } },
        { $limit: 10 },
    ]);

    if (resultLifeEvents.length === 0) return '';

    let lifeEventStr = 'Below are life events:\n\n';
    for (let index = 0; index < resultLifeEvents.length; index++) {
        const element = resultLifeEvents[index];
        if (element.title?.length >= 1) {
            lifeEventStr += `Life Event ${index + 1} -> title: ${element.title}.\n`;
        }
        if (element.description?.length >= 1) {
            lifeEventStr += `Life Event ${index + 1} -> description: ${NodeHtmlMarkdown.translate(element.description)}.\n`;
        }
        if (element.eventDateUtc) {
            lifeEventStr += `Life Event ${index + 1} -> event date: ${element.eventDateUtc}.\n`;
        }
        lifeEventStr += '\n';
    }
    return `${lifeEventStr}\n\n`;
}

async function getInfoVaultContentInline(contextIds: mongoose.Types.ObjectId[], username: string): Promise<string> {
    const resultInfoVault = await ModelInfoVault.aggregate([
        { $match: { username, _id: { $in: contextIds } } },
        { $limit: 10 },
    ]);

    if (resultInfoVault.length === 0) return '';

    let infoVaultStr = 'Below are info vault items:\n\n';
    for (let index = 0; index < resultInfoVault.length; index++) {
        const element = resultInfoVault[index];
        if (element.title?.length >= 1) {
            infoVaultStr += `Info Vault ${index + 1} -> title: ${element.title}.\n`;
        }
        if (element.description?.length >= 1) {
            infoVaultStr += `Info Vault ${index + 1} -> description: ${NodeHtmlMarkdown.translate(element.description)}.\n`;
        }
        infoVaultStr += '\n';
    }
    return `${infoVaultStr}\n\n`;
}

async function getMemoContentInline(contextIds: mongoose.Types.ObjectId[], username: string): Promise<string> {
    const resultMemos = await ModelMemoNote.aggregate([
        { $match: { username, _id: { $in: contextIds }, trashed: false } },
        {
            $lookup: {
                from: 'memoLabels',
                localField: 'labelIds',
                foreignField: '_id',
                as: 'memoLabelDocs',
            },
        },
        { $limit: 10 },
    ]);

    if (resultMemos.length === 0) return '';

    let memoStr = 'Below are Memo notes:\n\n';
    for (let index = 0; index < resultMemos.length; index++) {
        const element = resultMemos[index];
        memoStr += `Memo ${index + 1} -> title -> ${element.title || ''}.\n`;
        if (element.body?.length > 0) {
            const body =
                element.body.length > MEMO_INLINE_BODY_MAX
                    ? `${element.body.slice(0, MEMO_INLINE_BODY_MAX)}…`
                    : element.body;
            memoStr += `Memo ${index + 1} -> body -> ${body}.\n`;
        }
        const labelNames = (element.memoLabelDocs || [])
            .map((l: { name?: string }) => (typeof l?.name === 'string' ? l.name : ''))
            .filter((n: string) => n.length > 0);
        if (labelNames.length > 0) {
            memoStr += `Memo ${index + 1} -> labels -> ${labelNames.join(', ')}.\n`;
        }
        memoStr += '\n';
    }
    return `${memoStr}\n\n`;
}

async function getContextContentInline(contextIds: mongoose.Types.ObjectId[], username: string): Promise<string> {
    if (contextIds.length === 0) return '';

    const contextItems = await ModelGlobalSearch.find({
        username,
        entityId: { $in: contextIds },
    });

    const contextByCollection: Record<string, mongoose.Types.ObjectId[]> = {};
    for (const item of contextItems) {
        const collectionName = item.collectionName || 'unknown';
        if (!contextByCollection[collectionName]) contextByCollection[collectionName] = [];
        contextByCollection[collectionName].push(item.entityId);
    }

    const classifiedIds = new Set<string>();
    for (const ids of Object.values(contextByCollection)) {
        for (const id of ids) classifiedIds.add(id.toString());
    }
    const missingForGlobalSearch = contextIds.filter((id) => !classifiedIds.has(id.toString()));
    if (missingForGlobalSearch.length > 0) {
        const memoRows = await ModelMemoNote.find({
            username,
            _id: { $in: missingForGlobalSearch },
            trashed: false,
        })
            .select('_id')
            .lean();
        if (memoRows.length > 0) {
            contextByCollection.memo = memoRows.map((row) => row._id as mongoose.Types.ObjectId);
        }
    }

    let contextContent = '';
    if (contextByCollection.tasks?.length) contextContent += await getTasksContentInline(contextByCollection.tasks, username);
    if (contextByCollection.notes?.length) contextContent += await getNotesContentInline(contextByCollection.notes, username);
    if (contextByCollection.lifeEvents?.length) {
        contextContent += await getLifeEventsContentInline(contextByCollection.lifeEvents, username);
    }
    if (contextByCollection.infoVault?.length) {
        contextContent += await getInfoVaultContentInline(contextByCollection.infoVault, username);
    }
    if (contextByCollection.memoNotes?.length) {
        contextContent += await getMemoContentInline(contextByCollection.memoNotes, username);
    }
    if (contextByCollection.memo?.length) {
        contextContent += await getMemoContentInline(contextByCollection.memo, username);
    }

    return contextContent;
}

/** Pure integer multiply/add in question text → one-line node BigInt command (avoids LLM arithmetic errors). */
function tryDeriveDeterministicShellCommand(question: string): string | null {
    const normalized = question.replace(/,/g, '').replace(/\u00d7/g, '*').replace(/\s+/g, ' ');
    const mul = normalized.match(/\b(\d{1,120})\s*\*\s*(\d{1,120})\b/);
    if (mul?.[1] && mul?.[2]) {
        const a = mul[1];
        const b = mul[2];
        return `node -e "console.log((BigInt('${a}')*BigInt('${b}')).toString())"`;
    }
    const add = normalized.match(/\b(\d{1,120})\s*\+\s*(\d{1,120})\b/);
    if (add?.[1] && add?.[2]) {
        const a = add[1];
        const b = add[2];
        return `node -e "console.log((BigInt('${a}')+BigInt('${b}')).toString())"`;
    }
    return null;
}

/** Page-capture phrasing + http(s) URL or registrable domain → chromium screenshot line (same constraints as chat shell guidance). */
function tryDeriveChromiumScreenshotCommand(question: string): string | null {
    const wantsCapture =
        /\bscreenshot\b|\bscreen\s*[- ]?\s*shot\b|\bcapture\b.+\b(page|site|website|url|webpage)\b/i.test(question);
    if (!wantsCapture) return null;

    const httpsUrl = question.match(/https?:\/\/[^\s'"<>]+/i);
    if (httpsUrl) {
        const u = httpsUrl[0].replace(/'/g, "'\\''");
        return `chromium --headless=new --disable-gpu --no-sandbox --disable-dev-shm-usage --window-size=1280,2000 --screenshot=page.png '${u}'`;
    }

    const domainOnly = question.match(
        /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}\b/i
    );
    if (domainOnly) {
        const host = domainOnly[0].replace(/'/g, "'\\''");
        return `chromium --headless=new --disable-gpu --no-sandbox --disable-dev-shm-usage --window-size=1280,2000 --screenshot=page.png 'https://${host}/'`;
    }

    return null;
}

const SHELL_STDOUT_PREVIEW_MAX = 4000;
const SHELL_STDERR_PREVIEW_MAX = 4000;

type Am3ShellExecutionFields = {
    executedShellCommand: string;
    shellExecutionSuccess: boolean;
    shellExecutionHttpOk: boolean;
    shellExecutionExitCode: number | null;
    shellExecutionTimedOut: boolean;
    shellExecutionStdoutPreview: string;
    shellExecutionStderrPreview: string;
    shellEnginePreExecuteError: string;
    shellRetryGuidance: string;
};

function emptyShellMeta(partial: Partial<Am3ShellExecutionFields> & Pick<Am3ShellExecutionFields, 'shellRetryGuidance'>): Am3ShellExecutionFields {
    return {
        executedShellCommand: partial.executedShellCommand ?? '',
        shellExecutionSuccess: partial.shellExecutionSuccess ?? false,
        shellExecutionHttpOk: partial.shellExecutionHttpOk ?? false,
        shellExecutionExitCode: partial.shellExecutionExitCode ?? null,
        shellExecutionTimedOut: partial.shellExecutionTimedOut ?? false,
        shellExecutionStdoutPreview: partial.shellExecutionStdoutPreview ?? '',
        shellExecutionStderrPreview: partial.shellExecutionStderrPreview ?? '',
        shellEnginePreExecuteError: partial.shellEnginePreExecuteError ?? '',
        shellRetryGuidance: partial.shellRetryGuidance,
    };
}

function buildShellRetryGuidance(p: {
    shellCommand: string;
    preExecuteError?: string;
    httpOk?: boolean;
    exitCode?: number | null;
    timedOut?: boolean;
    successRun?: boolean;
    stderr?: string;
    stdout?: string;
    artifactAppendix?: string;
}): string {
    const parts: string[] = [];
    const stderr = (p.stderr ?? '').trim();
    const cmd = (p.shellCommand ?? '').toLowerCase();
    const errLower = stderr.toLowerCase();

    if (p.preExecuteError?.trim()) {
        parts.push(
            `Engine/validation blocked the command: ${p.preExecuteError.trim()}. Obey one-line rules; remove forbidden operators outside quotes.`
        );
    }
    if (p.timedOut) {
        parts.push(
            'Command timed out: shorten work, avoid infinite loops or blocking waits without a bound, split into smaller steps, or write output incrementally so the process can exit within the sandbox time limit.'
        );
    }
    if (p.httpOk === false && !p.preExecuteError?.trim()) {
        parts.push('Shell engine HTTP error: command may not have reached the sandbox; retry with a simpler command.');
    }
    if (p.exitCode !== null && p.exitCode !== undefined && p.exitCode !== 0 && !p.preExecuteError?.trim()) {
        parts.push(`Process exited with code ${p.exitCode}; fix arguments or dependencies based on stderr.`);
    }
    if (cmd.includes('chromium-browser') || errLower.includes('chromium-browser') || errLower.includes('snap')) {
        parts.push('Use the `chromium` binary with --headless=new, not chromium-browser or snap wrappers.');
    }
    const chromiumMissing =
        p.exitCode === 127 &&
        (cmd.includes('chromium') || errLower.includes('chromium')) &&
        (errLower.includes('not found') || errLower.includes('command not found') || errLower.includes('no such file'));
    if (chromiumMissing) {
        parts.push(
            'Chromium is not installed in this sandbox: chain `apt-get update -qq && apt-get install -y chromium` before the headless screenshot command in the same one-liner. Do not use package `chromium-browser` (snap stub); use package `chromium` only. After install, run `chromium` with --headless=new --no-sandbox --disable-dev-shm-usage.'
        );
    } else if (errLower.includes('command not found') || errLower.includes('not found')) {
        parts.push(
            'Required binary missing or wrong name: install via apt/npm/venv pip if appropriate, or use node/python/chromium as installed; try `command -v name`. Prefer node, then python, then other tools.'
        );
    }
    const out = (p.stdout ?? '').trim();
    const art = (p.artifactAppendix ?? '').trim();
    if (p.successRun === false && !p.preExecuteError?.trim() && !p.timedOut) {
        if (!out && !art) {
            parts.push('No stdout and no imported artifacts: echo results or create files in the workspace cwd.');
        }
    }
    if (parts.length === 0) {
        if (stderr) {
            return `Stderr hint: ${stderr.replace(/\s+/g, ' ').slice(0, 500)}`;
        }
        return 'Produce a revised one-liner that avoids the previous failure mode and satisfies the sub-question.';
    }
    return parts.join(' ');
}

function formatPriorShellAttemptForLlm(sq: {
    attemptNumber?: number;
    executedShellCommand?: string;
    shellExecutionSuccess?: boolean;
    shellExecutionHttpOk?: boolean;
    shellExecutionExitCode?: number | null;
    shellExecutionTimedOut?: boolean;
    shellExecutionStdoutPreview?: string;
    shellExecutionStderrPreview?: string;
    shellEnginePreExecuteError?: string;
    shellRetryGuidance?: string;
}): string {
    const lines: string[] = [];
    const att = typeof sq.attemptNumber === 'number' && sq.attemptNumber > 1 ? sq.attemptNumber : 0;
    if (att > 0) {
        lines.push(
            `This is shell retry attempt ${att}; the following is the failed previous run — produce a different one-liner that addresses stderr/exit code and any refine hints in the sub-question.`
        );
    }
    if (sq.executedShellCommand?.trim()) {
        lines.push(`Previous command:\n${sq.executedShellCommand.trim()}`);
    }
    if (sq.shellEnginePreExecuteError?.trim()) {
        lines.push(`Pre-run error:\n${sq.shellEnginePreExecuteError.trim()}`);
    } else {
        lines.push(
            `Previous outcome: success=${Boolean(sq.shellExecutionSuccess)} httpOk=${Boolean(sq.shellExecutionHttpOk)} exit=${sq.shellExecutionExitCode ?? 'n/a'} timedOut=${Boolean(sq.shellExecutionTimedOut)}`
        );
    }
    if (sq.shellExecutionStderrPreview?.trim()) {
        lines.push(`stderr (truncated):\n${sq.shellExecutionStderrPreview.trim().slice(0, 3500)}`);
    }
    if (sq.shellExecutionStdoutPreview?.trim()) {
        lines.push(`stdout (truncated):\n${sq.shellExecutionStdoutPreview.trim().slice(0, 2500)}`);
    }
    if (sq.shellRetryGuidance?.trim()) {
        lines.push(`How to improve next command:\n${sq.shellRetryGuidance.trim()}`);
    }
    return lines.join('\n\n');
}

async function llmGenerateShellCommandForAm3(
    question: string,
    conversationContext: string,
    llmConfig: LlmConfig,
    threadId: mongoose.Types.ObjectId,
    username: string,
    abortSignal?: AbortSignal,
    priorAttemptDetails?: string
): Promise<{
    shellCommand: string | null;
    tokens?: {
        promptTokens: number;
        completionTokens: number;
        reasoningTokens: number;
        totalTokens: number;
        costInUsd: number;
    };
}> {
    const sys = `You output exactly one JSON object with keys "taskName" (short string) and "shellCommand" only. No markdown.
The shell runs on Ubuntu 24.04 in Docker with Node.js and Python 3. shellCommand must be ONE physical line.
You may install packages (e.g. apt-get, npm, pip inside a venv) and run typical CLI tools — nothing is restricted by category — but each run is **time-limited** (~60s default; longer when the line clearly performs apt/npm/pip installs). The command must **finish**: no infinite loops (\`while true\`, unbounded recursion), no fork bombs, no long-lived daemons or servers that never exit, and no endless \`tail -f\` / blocking waits without a bound. Prefer bounded work that prints results or writes files in the workspace cwd.
Strict tool order (follow this whenever more than one approach could work): **(1) Node.js** — \`node -e\`, \`node ./script.js\`, npm/npx first; **(2) Python 3** — \`python3 -c\` or venv **only** when Node is awkward or clearly worse; **(3) other** — chromium, curl, standard POSIX tools, etc., **only** when the task clearly needs them.
For exact integer arithmetic (including very large integers), prefer Node BigInt, e.g.:
node -e "console.log((BigInt('3420943298')*BigInt('34290834287')).toString())"
To capture a live website as PNG in this environment, use headless Chromium (binary: \`chromium\`, NOT chromium-browser): e.g.
chromium --headless=new --disable-gpu --no-sandbox --disable-dev-shm-usage --window-size=1280,2000 --screenshot=page.png 'https://example.com'
The image may pre-install \`chromium\`; if PRIOR ATTEMPT shows exit 127 / "chromium: not found", install it in the same line first: \`apt-get update -qq && apt-get install -y chromium &&\` then the chromium headless command. Never use snap, never install \`chromium-browser\` (Ubuntu snap stub).
Forbidden: backticks, real newlines inside shellCommand, unquoted | ; & at the outer shell level, and $ / \${ outside single-quoted spans.
Prefer Node (\`node -e\`) over Python for math and JSON manipulation when both work; prefer node -e over mental math — never approximate large products yourself in JSON; output a runnable command that prints the exact result to stdout.`;

    let user =
        (priorAttemptDetails?.trim()
            ? `PRIOR ATTEMPT (your new shellCommand must fix this — do not repeat the same mistake):\n${priorAttemptDetails.trim()}\n\n`
            : '') +
        `SUB-QUESTION (produce shellCommand that answers it):\n${question}\n\nTHREAD CONTEXT (truncated):\n${conversationContext.slice(-3200)}`;

    const fb = await fetchLlmUnified({
        provider: llmConfig.provider,
        apiKey: llmConfig.apiKey,
        apiEndpoint: llmConfig.apiEndpoint,
        model: llmConfig.model,
        messages: [
            { role: 'system', content: sys },
            { role: 'user', content: user },
        ],
        temperature: 0.12,
        maxTokens: 512,
        headersExtra: llmConfig.customHeaders,
        abortSignal,
        responseFormat: 'json_object',
    });

    if (!fb.success || !fb.content) {
        return { shellCommand: null };
    }

    try {
        await trackAnswerMachineTokens(threadId, fb.usageStats, username, 'sub_question_answer');
    } catch {
        /* empty */
    }

    try {
        const obj = JSON.parse(fb.content.trim()) as Record<string, unknown>;
        const shellCommand = typeof obj.shellCommand === 'string' ? obj.shellCommand.trim() : '';
        if (!shellCommand) {
            return { shellCommand: null, tokens: fb.usageStats };
        }
        return { shellCommand, tokens: fb.usageStats };
    } catch {
        return { shellCommand: null, tokens: fb.usageStats };
    }
}

async function resolveShellArtifactSummary(
    threadId: mongoose.Types.ObjectId,
    username: string,
    parentMessageId: mongoose.Types.ObjectId
): Promise<string> {
    const parent = await ModelChatLlm.findOne({ _id: parentMessageId, threadId, username });
    if (!parent?.createdAtUtc) return '';

    const shellMsg = await ModelChatLlm.findOne({
        threadId,
        username,
        shellRunArtifactV1: { $exists: true, $ne: null },
        createdAtUtc: { $gte: parent.createdAtUtc },
    }).sort({ createdAtUtc: -1 });

    const art = shellMsg?.shellRunArtifactV1;
    if (!art || typeof art !== 'object') return '';

    try {
        const todos = Array.isArray((art as { todos?: unknown }).todos)
            ? JSON.stringify((art as { todos: unknown }).todos).slice(0, 8000)
            : '';
        const files = Array.isArray((art as { importedFiles?: unknown }).importedFiles)
            ? JSON.stringify((art as { importedFiles: unknown }).importedFiles).slice(0, 4000)
            : '';
        return `Shell artifact summary (truncated):\nTodos: ${todos}\nImported files: ${files}`;
    } catch {
        return '';
    }
}

async function answerKbSubQuestion(
    threadId: mongoose.Types.ObjectId,
    username: string,
    question: string,
    kbTypes: AnswerMachineKbKnowledgeTypeV3[],
    llmConfig: LlmConfig,
    abortSignal?: AbortSignal
): Promise<{
    answer: string;
    contextIds: mongoose.Types.ObjectId[];
    shellArtifactSummary: string;
    webResearchNotes: string;
    tokens?: {
        promptTokens: number;
        completionTokens: number;
        reasoningTokens: number;
        totalTokens: number;
        costInUsd: number;
    };
}> {
    const useShortTerm = kbTypes.includes('shortTermMemory');
    const collections = kbTypesToGlobalSearchCollections(kbTypes);

    const keywords = await generateKeywordsInline(question, llmConfig, threadId, username, abortSignal);
    if (abortSignal?.aborted) {
        return { answer: '', contextIds: [], shellArtifactSummary: '', webResearchNotes: '' };
    }

    let contextIds: mongoose.Types.ObjectId[] = [];

    if (collections.length > 0 && keywords.length > 0) {
        const hits = await searchContextIdsFiltered(keywords, username, collections, abortSignal);
        const scored =
            hits.length > 0
                ? await scoreContextReferencesInline(hits, keywords, threadId, username, llmConfig, abortSignal)
                : [];
        contextIds = scored
            .map((item) => {
                try {
                    return mongoose.Types.ObjectId.createFromHexString(item.entityId);
                } catch {
                    return null;
                }
            })
            .filter((id): id is mongoose.Types.ObjectId => id !== null);
    }

    let contextContent = '';
    if (contextIds.length > 0) {
        contextContent += await getContextContentInline(contextIds, username);
    }

    let stm = '';
    if (useShortTerm) {
        stm = await getConversationContextInline(threadId, username);
    }

    const conversationContext = await getConversationContextInline(threadId, username);

    let userPrompt = '';
    if (conversationContext) userPrompt += `CONVERSATION CONTEXT:\n${conversationContext}\n\n`;
    if (stm) userPrompt += `SHORT_TERM_MEMORY (recent chat excerpts):\n${stm}\n\n`;
    if (contextContent) userPrompt += `RELEVANT KNOWLEDGE BASE CONTEXT:\n${contextContent}\n\n`;
    userPrompt += `QUESTION: ${question}\n\nANSWER:`;

    const llmMessages: Message[] = [
        {
            role: 'system',
            content:
                'You answer using conversation context, optional short-term memory, and retrieved KB context. If information is missing, say so clearly.',
        },
        { role: 'user', content: userPrompt },
    ];

    const llmResult = await fetchLlmUnified({
        provider: llmConfig.provider,
        apiKey: llmConfig.apiKey,
        apiEndpoint: llmConfig.apiEndpoint,
        model: llmConfig.model,
        messages: llmMessages,
        temperature: 0.7,
        maxTokens: 4096,
        headersExtra: llmConfig.customHeaders,
        abortSignal,
    });

    if (!llmResult.success || !llmResult.content) {
        return { answer: '', contextIds, shellArtifactSummary: '', webResearchNotes: '' };
    }

    try {
        await trackAnswerMachineTokens(threadId, llmResult.usageStats, username, 'sub_question_answer');
    } catch {
        /* empty */
    }

    return {
        answer: llmResult.content.trim(),
        contextIds,
        shellArtifactSummary: '',
        webResearchNotes: '',
        tokens: llmResult.usageStats,
    };
}

async function answerShellSubQuestion(
    threadId: mongoose.Types.ObjectId,
    username: string,
    parentMessageId: mongoose.Types.ObjectId,
    question: string,
    llmConfig: LlmConfig,
    answerMachineRequestV3Id: mongoose.Types.ObjectId,
    answerMachineIteration: number,
    answerMachineSubQuestionV3Id: mongoose.Types.ObjectId,
    abortSignal?: AbortSignal
): Promise<{
    answer: string;
    contextIds: mongoose.Types.ObjectId[];
    shellArtifactSummary: string;
    webResearchNotes: string;
    tokens?: {
        promptTokens: number;
        completionTokens: number;
        reasoningTokens: number;
        totalTokens: number;
        costInUsd: number;
    };
    shellExecutionMeta: Am3ShellExecutionFields;
}> {
    const noMeta = (g: string): Am3ShellExecutionFields =>
        emptyShellMeta({
            shellRetryGuidance: g,
        });

    if (abortSignal?.aborted) {
        return {
            answer: '',
            contextIds: [],
            shellArtifactSummary: '',
            webResearchNotes: '',
            shellExecutionMeta: noMeta('Aborted before shell run.'),
        };
    }

    const sqPrior = await ModelAnswerMachineSubQuestionV3.findById(answerMachineSubQuestionV3Id).lean();
    const priorAttemptBlock =
        sqPrior?.executedShellCommand?.trim() || sqPrior?.shellEnginePreExecuteError?.trim()
            ? formatPriorShellAttemptForLlm(sqPrior)
            : '';

    const conversationContext = await getConversationContextInline(threadId, username);
    const priorChatArtifact = await resolveShellArtifactSummary(threadId, username, parentMessageId);

    // After a failed shell run (verify retry), deterministic shortcuts would repeat the same command;
    // always use the LLM with PRIOR ATTEMPT + refined sub-question instead.
    let shellCommand: string | null = null;
    if (!priorAttemptBlock) {
        shellCommand = tryDeriveDeterministicShellCommand(question);
        if (!shellCommand) {
            shellCommand = tryDeriveChromiumScreenshotCommand(question);
        }
    }
    let planTokens:
        | {
              promptTokens: number;
              completionTokens: number;
              reasoningTokens: number;
              totalTokens: number;
              costInUsd: number;
          }
        | undefined;

    if (!shellCommand) {
        const planned = await llmGenerateShellCommandForAm3(
            question,
            conversationContext,
            llmConfig,
            threadId,
            username,
            abortSignal,
            priorAttemptBlock || undefined
        );
        shellCommand = planned.shellCommand ?? null;
        planTokens = planned.tokens;
    }

    const summaryChunks: string[] = [];
    if (priorChatArtifact) {
        summaryChunks.push(`Prior shell message artifact (context only):\n${priorChatArtifact}`);
    }

    if (!shellCommand) {
        summaryChunks.push('Could not plan a shell command (deterministic pattern did not match and LLM returned none).');
        return {
            answer:
                'Could not plan a shell command for this sub-question. Ensure Shell Engine URL/token are set under API Keys, or ask with explicit integers for multiply/add patterns.',
            contextIds: [],
            shellArtifactSummary: summaryChunks.join('\n\n'),
            webResearchNotes: '',
            tokens: planTokens,
            shellExecutionMeta: emptyShellMeta({
                shellRetryGuidance:
                    'No command was produced. Prefer explicit numeric patterns, https URLs for screenshots, or a concrete file path. If retrying, use PRIOR ATTEMPT stderr/exit hints above.',
            }),
        };
    }

    summaryChunks.push(`Executed shellCommand:\n${shellCommand}`);

    const exec = await executeAnswerMachineShellCommand({
        threadId,
        username,
        shellCommand,
        answerMachineContext: {
            answerMachineRequestV3Id,
            answerMachineIteration,
            answerMachineSubQuestionV3Id,
        },
    });

    if (!exec.ok) {
        summaryChunks.push(`Shell engine failed before execute: ${exec.error}`);
        const guidance = buildShellRetryGuidance({
            shellCommand,
            preExecuteError: exec.error,
        });
        return {
            answer: `Shell execution did not run: ${exec.error}`,
            contextIds: [],
            shellArtifactSummary: summaryChunks.join('\n\n'),
            webResearchNotes: '',
            tokens: planTokens,
            shellExecutionMeta: emptyShellMeta({
                executedShellCommand: shellCommand,
                shellExecutionSuccess: false,
                shellExecutionHttpOk: false,
                shellExecutionExitCode: null,
                shellExecutionTimedOut: false,
                shellEnginePreExecuteError: exec.error,
                shellRetryGuidance: guidance,
            }),
        };
    }

    summaryChunks.push(
        `exitCode=${exec.exitCode} httpOk=${exec.httpOk} timedOut=${exec.timedOut}`,
        exec.stdout.trim() ? `stdout:\n${exec.stdout.slice(0, 8000)}` : '(empty stdout)',
        exec.stderr.trim() ? `stderr:\n${exec.stderr.slice(0, 6000)}` : ''
    );

    if (exec.artifactSummaryAppendix?.trim()) {
        summaryChunks.push(`\nShell artifacts imported:\n${exec.artifactSummaryAppendix}`);
    }

    const artifactAppendix = exec.artifactSummaryAppendix?.trim() ?? '';
    const stdoutTrimmed = exec.stdout.trim();
    const stderrFull = exec.stderr.trim();
    const successRun =
        exec.httpOk &&
        exec.exitCode === 0 &&
        !exec.timedOut &&
        (stdoutTrimmed.length > 0 || artifactAppendix.length > 0);

    const stdoutPreview = stdoutTrimmed.slice(0, SHELL_STDOUT_PREVIEW_MAX);
    const stderrPreview = stderrFull.slice(0, SHELL_STDERR_PREVIEW_MAX);

    const failureAnswer = [
        'Shell command finished without a clean success.',
        `httpOk=${exec.httpOk} exitCode=${exec.exitCode ?? 'null'} timedOut=${exec.timedOut}`,
        stdoutTrimmed ? `stdout:\n${stdoutTrimmed}` : '',
        stderrFull ? `stderr:\n${stderrFull}` : '',
    ]
        .filter(Boolean)
        .join('\n\n');

    const answer = successRun
        ? stdoutTrimmed ||
          artifactAppendix ||
          'Shell completed successfully; output is in the imported artifacts below.'
        : failureAnswer;

    const guidance = buildShellRetryGuidance({
        shellCommand,
        httpOk: exec.httpOk,
        exitCode: exec.exitCode,
        timedOut: exec.timedOut,
        successRun,
        stderr: stderrFull,
        stdout: stdoutTrimmed,
        artifactAppendix,
    });

    return {
        answer,
        contextIds: [],
        shellArtifactSummary: summaryChunks.filter(Boolean).join('\n\n'),
        webResearchNotes: '',
        tokens: planTokens,
        shellExecutionMeta: {
            executedShellCommand: shellCommand,
            shellExecutionSuccess: successRun,
            shellExecutionHttpOk: exec.httpOk,
            shellExecutionExitCode: exec.exitCode,
            shellExecutionTimedOut: exec.timedOut,
            shellExecutionStdoutPreview: stdoutPreview,
            shellExecutionStderrPreview: stderrPreview,
            shellEnginePreExecuteError: '',
            shellRetryGuidance: successRun ? '' : guidance,
        },
    };
}

/** Answer a single pending sub-question and persist result. Used by sequential AM3 loop and legacy step3 batch (sequential). */
export async function answerOneSubQuestionById(params: {
    subQuestionId: mongoose.Types.ObjectId;
    abortSignal?: AbortSignal;
}): Promise<{ ok: boolean; cancelled: boolean; errorReason: string }> {
    const { subQuestionId, abortSignal } = params;
    try {
        const sq = await ModelAnswerMachineSubQuestionV3.findById(subQuestionId);
        if (!sq) {
            return { ok: false, cancelled: false, errorReason: 'Sub-question not found' };
        }
        if (sq.status !== 'pending') {
            return { ok: false, cancelled: false, errorReason: 'Sub-question is not pending' };
        }

        const llmConfig = await getLlmConfig({ threadId: sq.threadId });
        if (!llmConfig) {
            await ModelAnswerMachineSubQuestionV3.findByIdAndUpdate(sq._id, {
                $set: { status: 'error', errorReason: 'No LLM configuration', updatedAtUtc: new Date() },
            });
            return { ok: false, cancelled: false, errorReason: 'No LLM configuration found' };
        }

        let payload: Awaited<ReturnType<typeof answerKbSubQuestion>>;
        let shellExecutionMeta: Am3ShellExecutionFields | undefined;

        if (sq.kind === 'shell') {
            const sp = await answerShellSubQuestion(
                sq.threadId,
                sq.username,
                sq.parentMessageId,
                sq.question || '',
                llmConfig,
                sq.answerMachineRequestV3Id,
                sq.answerMachineIteration,
                sq._id,
                abortSignal
            );
            payload = sp;
            shellExecutionMeta = sp.shellExecutionMeta;
        } else if (sq.kind === 'web') {
            payload = await answerWebSubQuestion(sq.threadId, sq.username, sq.question || '', llmConfig, abortSignal);
        } else {
            payload = await answerKbSubQuestion(
                sq.threadId,
                sq.username,
                sq.question || '',
                (sq.kbKnowledgeTypes?.length
                    ? sq.kbKnowledgeTypes
                    : ['notes', 'tasks', 'lifeEvents', 'infoVault', 'memoNotes']) as AnswerMachineKbKnowledgeTypeV3[],
                llmConfig,
                abortSignal
            );
        }

        if (abortSignal?.aborted) {
            return { ok: false, cancelled: true, errorReason: 'Cancelled' };
        }

        if (!payload.answer?.trim()) {
            await ModelAnswerMachineSubQuestionV3.findByIdAndUpdate(sq._id, {
                $set: { status: 'error', errorReason: 'Empty answer', updatedAtUtc: new Date() },
            });
            return { ok: false, cancelled: false, errorReason: 'Empty answer' };
        }

        const setDoc: Record<string, unknown> = {
            status: 'answered',
            answer: payload.answer,
            contextIds: payload.contextIds,
            shellArtifactSummary: payload.shellArtifactSummary,
            webResearchNotes: payload.webResearchNotes,
            aiModelName: llmConfig.model,
            aiModelProvider: llmConfig.provider,
            promptTokens: payload.tokens?.promptTokens ?? 0,
            completionTokens: payload.tokens?.completionTokens ?? 0,
            reasoningTokens: payload.tokens?.reasoningTokens ?? 0,
            totalTokens: payload.tokens?.totalTokens ?? 0,
            costInUsd: payload.tokens?.costInUsd ?? 0,
            updatedAtUtc: new Date(),
        };

        if (shellExecutionMeta) {
            Object.assign(setDoc, shellExecutionMeta);
        }

        await ModelAnswerMachineSubQuestionV3.findByIdAndUpdate(sq._id, {
            $set: setDoc,
        });

        return { ok: true, cancelled: false, errorReason: '' };
    } catch (err) {
        await ModelAnswerMachineSubQuestionV3.findByIdAndUpdate(subQuestionId, {
            $set: {
                status: 'error',
                errorReason: err instanceof Error ? err.message : 'Unknown error',
                updatedAtUtc: new Date(),
            },
        });
        return { ok: false, cancelled: false, errorReason: err instanceof Error ? err.message : 'Unknown error' };
    }
}

async function answerWebSubQuestion(
    threadId: mongoose.Types.ObjectId,
    username: string,
    question: string,
    llmConfig: LlmConfig,
    abortSignal?: AbortSignal
): Promise<{
    answer: string;
    contextIds: mongoose.Types.ObjectId[];
    shellArtifactSummary: string;
    webResearchNotes: string;
    tokens?: {
        promptTokens: number;
        completionTokens: number;
        reasoningTokens: number;
        totalTokens: number;
        costInUsd: number;
    };
}> {
    const conversationContext = await getConversationContextInline(threadId, username);

    const userPrompt =
        (conversationContext ? `CONVERSATION:\n${conversationContext}\n\n` : '') +
        `QUESTION (answer with broad knowledge; flag uncertainty for time-sensitive facts):\n${question}`;

    const llmResult = await fetchLlmUnified({
        provider: llmConfig.provider,
        apiKey: llmConfig.apiKey,
        apiEndpoint: llmConfig.apiEndpoint,
        model: llmConfig.model,
        messages: [
            {
                role: 'system',
                content:
                    'You simulate a careful web-informed brief: use general knowledge, note when verification online would be needed, avoid fabricated citations.',
            },
            { role: 'user', content: userPrompt },
        ],
        temperature: 0.55,
        maxTokens: 4096,
        headersExtra: llmConfig.customHeaders,
        abortSignal,
    });

    if (!llmResult.success || !llmResult.content) {
        return { answer: '', contextIds: [], shellArtifactSummary: '', webResearchNotes: '' };
    }

    try {
        await trackAnswerMachineTokens(threadId, llmResult.usageStats, username, 'sub_question_answer');
    } catch {
        /* empty */
    }

    const notes = llmResult.content.trim().slice(0, 2000);

    return {
        answer: llmResult.content.trim(),
        contextIds: [],
        shellArtifactSummary: '',
        webResearchNotes: notes,
        tokens: llmResult.usageStats,
    };
}

const step3AnswerSubQuestions = async ({
    answerMachineRequestV3Id,
    abortSignal,
}: {
    answerMachineRequestV3Id: mongoose.Types.ObjectId;
    abortSignal?: AbortSignal;
}): Promise<{ success: boolean; errorReason: string; data: null }> => {
    try {
        const reqRow = await ModelAnswerMachineRequestV3.findById(answerMachineRequestV3Id);
        if (!reqRow) {
            return { success: false, errorReason: 'Answer Machine V3 request not found', data: null };
        }

        const pendingSubQuestions = await ModelAnswerMachineSubQuestionV3.find({
            answerMachineRequestV3Id,
            answerMachineIteration: reqRow.currentIteration,
            status: 'pending',
        }).sort({ createdAtUtc: 1 });

        if (pendingSubQuestions.length === 0) {
            return { success: true, errorReason: '', data: null };
        }

        const llmConfig = await getLlmConfig({ threadId: reqRow.threadId });
        if (!llmConfig) {
            return { success: false, errorReason: 'No LLM configuration found', data: null };
        }

        for (const sq of pendingSubQuestions) {
            const one = await answerOneSubQuestionById({ subQuestionId: sq._id as mongoose.Types.ObjectId, abortSignal });
            if (one.cancelled || abortSignal?.aborted) {
                return { success: false, errorReason: 'Cancelled', data: null };
            }
            if (!one.ok) {
                return { success: false, errorReason: one.errorReason || 'Sub-question failed', data: null };
            }
        }

        return { success: true, errorReason: '', data: null };
    } catch (error) {
        console.error(`❌ AM3 step3 (request ${answerMachineRequestV3Id}):`, error);
        return {
            success: false,
            errorReason: error instanceof Error ? error.message : 'Internal server error',
            data: null,
        };
    }
};

export default step3AnswerSubQuestions;
