/**
 * Shared harness for agent use-case scratchpad tests under testCasesByJs/.
 *
 * Run one case:
 *   npx ts-node -r dotenv/config ./srcTest/2026-08-06-make-agent-better/testCasesByJs/test-1-create-a-pdf-with-datetime/run.ts
 *
 * Env (optional):
 *   AGENT_TEST_USER_ID=672e4c845965b89f611a7ace
 *   AGENT_TEST_MODEL_PROVIDER=openrouter
 *   AGENT_TEST_MODEL_NAME=google/gemma-4-26b-a4b-it
 *   AGENT_TEST_TIMEOUT_MS=600000
 */
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import mongoose from 'mongoose';

import envKeys from '../../../../src/config/envKeys';
import { ModelUser } from '../../../../src/schema/schemaUser/SchemaUser.schema';
import { ModelUserApiKey } from '../../../../src/schema/schemaUser/SchemaUserApiKey.schema';
import { ModelChatLlmThread } from '../../../../src/schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelChatLlm } from '../../../../src/schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelAgentInstance } from '../../../../src/schema/schemaChatLlm/SchemaAgent/SchemaAgentInstance.schema';
import { ModelAgentGoal } from '../../../../src/schema/schemaChatLlm/SchemaAgent/SchemaAgentGoal.schema';
import agentInitiateFunc from '../../../../src/routes/chatLlm/chatLlmCrud/agent/agentInit';
import agentProcessTick from '../../../../src/routes/chatLlm/chatLlmCrud/agent/agentProcessTick';
import {
    agentTaskFilesDir,
    getAgentShellConfig,
} from '../../../../src/routes/chatLlm/chatLlmCrud/agent/agentUtils/agentShell/agentShellWorkspace';
import { uploadBufferToShellEngine } from '../../../../src/routes/chatLlm/chatLlmCrud/shellExecute/shellFileUpload';
import { getApiKeyByObject } from '../../../../src/utils/llm/llmCommonFunc';
import { listWorkspaceDeliverables } from '../../../../src/routes/chatLlm/chatLlmCrud/agent/agentWork/agentPlanVerify';

export type CheckResult = {
    name: string;
    ok: boolean;
    detail?: string;
};

export type AgentUseCaseConfig = {
    /** Short slug used in folder / Auto title */
    slug: string;
    /** Human title fragment after "Auto - " */
    title: string;
    /** User prompt sent to the agent */
    prompt: string;
    /** Enable personal context (life-advice case) */
    personalContext?: boolean;
    /** Optional local file to upload into agent workspace before the run */
    fixtureUpload?: {
        localPath: string;
        destFileName: string;
        mimeType?: string;
    };
    /** Multiple fixtures preserving relative paths under the agent workspace root */
    fixtureUploads?: Array<{
        localPath: string;
        /** Path relative to agent workspace root (e.g. input.txt or nested/a.txt) */
        destRelativePath: string;
        mimeType?: string;
    }>;
    /** Extra assertions after the agent finishes */
    assert?: (ctx: AgentRunContext) => Promise<CheckResult[]>;
    /** Max wall-clock wait (ms) */
    timeoutMs?: number;
};

export type AgentRunContext = {
    userId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    threadTitle: string;
    agentInstanceId: mongoose.Types.ObjectId;
    agentDir: string;
    shellListing: Array<{
        relativePath: string;
        pathInAgentFolder?: string;
        absolutePath: string;
        isDir: boolean;
        size: number;
    }>;
    deliverables: ReturnType<typeof listWorkspaceDeliverables>;
    finalMessages: Array<{ content: string; tags: string[] }>;
    agentStatus: string;
    statusIsRunning: boolean;
    brainStep: string | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Treat empty / "default" / "default ..." as unset so README-style placeholders work. */
const envOrDefault = (key: string, fallback: string): string => {
    const raw = (process.env[key] || '').trim();
    if (!raw || raw === 'default' || /^default\s+/i.test(raw)) return fallback;
    return raw;
};

const envOrDefaultNumber = (key: string, fallback: number): number => {
    const raw = (process.env[key] || '').trim();
    if (!raw || raw === 'default') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

const formatAutoTitle = (title: string): string => {
    const dt = new Date().toISOString().replace('T', ' ').slice(0, 19);
    return `Auto - ${title} - ${dt}`;
};

export const connectDb = async (): Promise<void> => {
    if (!envKeys.MONGODB_URI) {
        throw new Error('MONGODB_URI missing — load dotenv');
    }
    await mongoose.connect(envKeys.MONGODB_URI);
};

export const disconnectDb = async (): Promise<void> => {
    await mongoose.disconnect();
};

const resolveTestUserId = async (): Promise<mongoose.Types.ObjectId> => {
    const fromEnv = process.env.AGENT_TEST_USER_ID?.trim();
    if (fromEnv && mongoose.Types.ObjectId.isValid(fromEnv)) {
        return new mongoose.Types.ObjectId(fromEnv);
    }

    const withShell = await ModelUserApiKey.findOne({
        shellEngineValid: true,
        shellEngineUrl: { $ne: '' },
        shellEngineToken: { $ne: '' },
    })
        .select('userId')
        .lean();
    if (withShell?.userId) {
        return withShell.userId as mongoose.Types.ObjectId;
    }

    const anyUser = await ModelUser.findOne({}).select('_id').lean();
    if (!anyUser?._id) {
        throw new Error('No user found for agent tests — set AGENT_TEST_USER_ID');
    }
    return anyUser._id as mongoose.Types.ObjectId;
};

const resolveModel = () => ({
    provider: envOrDefault('AGENT_TEST_MODEL_PROVIDER', 'openrouter'),
    name: envOrDefault('AGENT_TEST_MODEL_NAME', 'google/gemma-4-26b-a4b-it').replace(
        /^default\s+/i,
        ''
    ),
});

export const listAgentShellFiles = async (params: {
    userId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
}): Promise<AgentRunContext['shellListing']> => {
    const apiKeyDoc = await ModelUserApiKey.findOne({ userId: params.userId });
    if (!apiKeyDoc) return [];
    const apiKey = getApiKeyByObject(apiKeyDoc);
    const shell = getAgentShellConfig(apiKey);
    if (!shell) return [];

    const agentDir = agentTaskFilesDir(String(params.threadId));
    const res = await axios.get(`${shell.baseUrl.replace(/\/+$/, '')}/api/shell-engine/file/list`, {
        params: { relativeDir: agentDir, maxFiles: 2000 },
        timeout: 30_000,
        headers: { 'X-API-Token': shell.token },
        validateStatus: () => true,
    });
    if (res.status !== 200 || !res.data || typeof res.data !== 'object') return [];
    const raw = Array.isArray((res.data as { files?: unknown }).files)
        ? ((res.data as { files: unknown[] }).files)
        : [];

    return raw
        .map((item) => {
            if (!item || typeof item !== 'object') return null;
            const o = item as Record<string, unknown>;
            const rel = typeof o.relativePath === 'string' ? o.relativePath.replace(/\\/g, '/') : '';
            if (!rel) return null;
            if (/\/venv\/|\/venv_|site-packages|node_modules|__pycache__/i.test(rel)) return null;
            const abs =
                typeof o.absolutePath === 'string' && o.absolutePath.trim()
                    ? o.absolutePath.replace(/\\/g, '/')
                    : `/app/data/${rel}`;
            const folderIdx = rel.indexOf(`${agentDir}/`);
            const pathInAgentFolder =
                folderIdx !== -1 ? rel.slice(folderIdx + agentDir.length + 1) : rel;
            return {
                relativePath: rel,
                pathInAgentFolder,
                absolutePath: abs,
                isDir: Boolean(o.isDir),
                size: typeof o.size === 'number' ? o.size : 0,
            };
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x));
};

const uploadFixtureToAgentWorkspace = async (params: {
    userId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    localPath: string;
    destFileName: string;
    mimeType?: string;
    /** When set, upload under this relative path inside the agent dir (not uploads/) */
    destRelativePath?: string;
}): Promise<{ relativePath: string; absolutePath: string }> => {
    const apiKeyDoc = await ModelUserApiKey.findOne({ userId: params.userId });
    if (!apiKeyDoc) throw new Error('User API keys not found for fixture upload');
    const apiKey = getApiKeyByObject(apiKeyDoc);
    const shell = getAgentShellConfig(apiKey);
    if (!shell) throw new Error('Shell engine not configured for fixture upload');

    const buf = fs.readFileSync(params.localPath);
    const destRel = (params.destRelativePath || `uploads/${params.destFileName}`)
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
    if (destRel.includes('..')) throw new Error(`Invalid fixture dest: ${destRel}`);
    const relativePath = `${agentTaskFilesDir(String(params.threadId))}/${destRel}`;
    const written = await uploadBufferToShellEngine({
        baseUrl: shell.baseUrl,
        token: shell.token,
        relativePath,
        buffer: buf,
        fileName: path.basename(destRel),
        mimeType: params.mimeType || 'application/octet-stream',
    });
    if (!written.ok) {
        throw new Error(`Fixture upload failed: ${written.error}`);
    }
    return { relativePath: written.relativePath, absolutePath: written.absolutePath };
};

const createAgentThread = async (params: {
    userId: mongoose.Types.ObjectId;
    title: string;
    personalContext?: boolean;
}): Promise<mongoose.Types.ObjectId> => {
    const model = resolveModel();
    const now = new Date();
    const thread = await ModelChatLlmThread.create({
        userId: params.userId,
        threadTitle: params.title,
        isAutoAiContextSelectEnabled: false,
        isPersonalContextEnabled: Boolean(params.personalContext),
        isMemoryEnabled: Boolean(params.personalContext),
        aiModelProvider: model.provider,
        aiModelName: model.name,
        answerEngine: 'agent',
        executeShell: true,
        shellExecuteMinAttempts: 1,
        shellExecuteMaxAttempts: 1,
        agentMinBudgetTokens: 1,
        agentMaxBudgetTokens: 1_000_000,
        agentMinNumberOfIterations: 1,
        agentMaxNumberOfIterations: 40,
        createdAtUtc: now,
        updatedAtUtc: now,
    });
    return thread._id as mongoose.Types.ObjectId;
};

const driveAgentUntilDone = async (params: {
    agentInstanceId: mongoose.Types.ObjectId;
    timeoutMs: number;
}): Promise<void> => {
    const started = Date.now();
    let idleRounds = 0;

    while (Date.now() - started < params.timeoutMs) {
        const agent = await ModelAgentInstance.findById(params.agentInstanceId)
            .select('status brainStep statusIsRunning tickCount updatedAtUtc')
            .lean();
        if (!agent) throw new Error('Agent instance disappeared');

        if (agent.status === 'success' || agent.status === 'failed') {
            return;
        }

        // Test harness: clear stale locks quickly (hung shell / crash)
        if (agent.statusIsRunning) {
            const updated = agent.updatedAtUtc ? new Date(agent.updatedAtUtc).getTime() : 0;
            if (!updated || Date.now() - updated > 45_000) {
                await ModelAgentInstance.updateOne(
                    { _id: params.agentInstanceId, statusIsRunning: true },
                    { $set: { statusIsRunning: false, updatedAtUtc: new Date() } }
                );
            } else {
                await sleep(1000);
                continue;
            }
        }

        const beforeTick = agent.tickCount || 0;
        await agentProcessTick(params.agentInstanceId);
        await sleep(400);

        const after = await ModelAgentInstance.findById(params.agentInstanceId)
            .select('status tickCount statusIsRunning')
            .lean();
        if (!after) return;
        if (after.status === 'success' || after.status === 'failed') return;

        if ((after.tickCount || 0) === beforeTick && after.statusIsRunning === false) {
            idleRounds += 1;
            if (idleRounds >= 20) {
                throw new Error(
                    `Agent stalled (tick=${after.tickCount}, running=${after.statusIsRunning})`
                );
            }
            await sleep(1000);
        } else {
            idleRounds = 0;
        }
    }

    throw new Error(`Agent timed out after ${params.timeoutMs}ms`);
};

const baseAssertions = async (ctx: AgentRunContext): Promise<CheckResult[]> => {
    const checks: CheckResult[] = [];

    checks.push({
        name: 'agent_status_success',
        ok: ctx.agentStatus === 'success',
        detail: `status=${ctx.agentStatus}`,
    });
    checks.push({
        name: 'agent_not_running',
        ok: ctx.statusIsRunning === false,
        detail: `statusIsRunning=${ctx.statusIsRunning}`,
    });
    checks.push({
        name: 'agent_brain_done',
        ok: ctx.brainStep === 'done',
        detail: `brainStep=${ctx.brainStep}`,
    });

    const goals = await ModelAgentGoal.find({ agentInstanceId: ctx.agentInstanceId })
        .select('status title')
        .lean();
    const openGoals = goals.filter((g) => g.status === 'pending' || g.status === 'in_progress');
    checks.push({
        name: 'no_open_goals',
        ok: openGoals.length === 0,
        detail: openGoals.map((g) => `${g.title}:${g.status}`).join(', ') || 'none open',
    });

    const finals = ctx.finalMessages.filter(
        (m) =>
            Array.isArray(m.tags) &&
            m.tags.includes('finalize') &&
            m.tags.includes('agent_success') &&
            !String(m.content || '').includes('AI generating in progress')
    );
    checks.push({
        name: 'single_final_success_message',
        ok: finals.length === 1,
        detail: `count=${finals.length}`,
    });

    const stuck = ctx.finalMessages.filter((m) =>
        String(m.content || '').includes('AI generating in progress')
    );
    checks.push({
        name: 'no_stuck_streaming_placeholder',
        ok: stuck.length === 0,
        detail: `stuck=${stuck.length}`,
    });

    return checks;
};

export const assertHasDeliverableExt = (
    ctx: AgentRunContext,
    ext: RegExp,
    label: string
): CheckResult => {
    const hit = ctx.deliverables.find((d) => ext.test(d.relativePath) && d.size > 0);
    return {
        name: `deliverable_${label}`,
        ok: Boolean(hit),
        detail: hit
            ? `${hit.pathInAgentFolder} (${hit.size}b)`
            : `missing; files=${ctx.deliverables.map((d) => d.pathInAgentFolder).join(', ') || 'none'}`,
    };
};

/** Match any non-dir shell listing entry by basename or relative path regex. */
export const assertWorkspacePath = (
    ctx: AgentRunContext,
    match: RegExp,
    label: string,
    minSize = 1
): CheckResult => {
    const hit = ctx.shellListing.find(
        (f) =>
            !f.isDir &&
            f.size >= minSize &&
            (match.test(f.relativePath) || match.test(f.pathInAgentFolder || ''))
    );
    return {
        name: `workspace_${label}`,
        ok: Boolean(hit),
        detail: hit
            ? `${hit.pathInAgentFolder || hit.relativePath} (${hit.size}b)`
            : `missing; listing=${ctx.shellListing
                  .filter((f) => !f.isDir)
                  .map((f) => f.pathInAgentFolder || f.relativePath)
                  .slice(0, 12)
                  .join(', ') || 'none'}`,
    };
};

export const runAgentUseCase = async (
    config: AgentUseCaseConfig
): Promise<{ ok: boolean; checks: CheckResult[]; ctx?: AgentRunContext; error?: string }> => {
    const timeoutMs =
        config.timeoutMs || envOrDefaultNumber('AGENT_TEST_TIMEOUT_MS', 600_000);
    const threadTitle = formatAutoTitle(config.title);

    console.log(`\n=== ${config.slug} ===`);
    console.log(`Title: ${threadTitle}`);

    const userId = await resolveTestUserId();
    console.log(`User: ${String(userId)}`);

    const threadId = await createAgentThread({
        userId,
        title: threadTitle,
        personalContext: config.personalContext,
    });
    console.log(`Thread: ${String(threadId)}`);
    console.log(`Chat UI: http://localhost:3000/user/chat?id=${String(threadId)}`);

    let prompt = config.prompt;
    const uploadedLines: string[] = [];

    if (config.fixtureUpload) {
        const absFixture = path.isAbsolute(config.fixtureUpload.localPath)
            ? config.fixtureUpload.localPath
            : path.resolve(config.fixtureUpload.localPath);
        if (!fs.existsSync(absFixture)) {
            throw new Error(`Fixture not found: ${absFixture}`);
        }
        const uploaded = await uploadFixtureToAgentWorkspace({
            userId,
            threadId,
            localPath: absFixture,
            destFileName: config.fixtureUpload.destFileName,
            mimeType: config.fixtureUpload.mimeType,
        });
        uploadedLines.push(`- ${uploaded.absolutePath} (relative: ${uploaded.relativePath})`);
        console.log(`Uploaded fixture → ${uploaded.relativePath}`);
    }

    if (config.fixtureUploads?.length) {
        for (const fix of config.fixtureUploads) {
            const absFixture = path.isAbsolute(fix.localPath)
                ? fix.localPath
                : path.resolve(fix.localPath);
            if (!fs.existsSync(absFixture)) {
                throw new Error(`Fixture not found: ${absFixture}`);
            }
            const uploaded = await uploadFixtureToAgentWorkspace({
                userId,
                threadId,
                localPath: absFixture,
                destFileName: path.basename(fix.destRelativePath),
                destRelativePath: fix.destRelativePath,
                mimeType: fix.mimeType,
            });
            uploadedLines.push(`- ${uploaded.absolutePath} (workspace: ${fix.destRelativePath})`);
            console.log(`Uploaded fixture → ${uploaded.relativePath}`);
        }
    }

    if (uploadedLines.length) {
        prompt = `${prompt}\n\nInput files already in workspace:\n${uploadedLines.join('\n')}`;
    }

    const userMsg = await ModelChatLlm.create({
        type: 'text',
        content: prompt,
        userId: userId.toString(),
        threadId,
        isAi: false,
        tags: ['agent-test'],
        createdAtUtc: new Date(),
        updatedAtUtc: new Date(),
    });

    const init = await agentInitiateFunc({
        messageId: userMsg._id as mongoose.Types.ObjectId,
    });
    if (!init.success || !init.agentInstanceId) {
        throw new Error(`agentInitiateFunc failed: ${init.errorReason}`);
    }
    const agentInstanceId = new mongoose.Types.ObjectId(init.agentInstanceId);
    console.log(`Agent: ${String(agentInstanceId)}`);

    await driveAgentUntilDone({ agentInstanceId, timeoutMs });

    const agent = await ModelAgentInstance.findById(agentInstanceId).lean();
    if (!agent) throw new Error('Agent missing after run');

    const shellListing = await listAgentShellFiles({ userId, threadId });
    const deliverables = listWorkspaceDeliverables(shellListing);
    const runTag = `agent-run:${String(agentInstanceId)}`;
    const chatDocs = await ModelChatLlm.find({
        threadId,
        isAi: true,
        tags: runTag,
    })
        .select('content tags')
        .lean();

    const ctx: AgentRunContext = {
        userId,
        threadId,
        threadTitle,
        agentInstanceId,
        agentDir: agentTaskFilesDir(String(threadId)),
        shellListing,
        deliverables,
        finalMessages: chatDocs.map((m) => ({
            content: String(m.content || ''),
            tags: Array.isArray(m.tags) ? (m.tags as string[]) : [],
        })),
        agentStatus: String(agent.status || ''),
        statusIsRunning: Boolean(agent.statusIsRunning),
        brainStep: (agent.brainStep as string) || null,
    };

    const checks = [
        ...(await baseAssertions(ctx)),
        ...((config.assert ? await config.assert(ctx) : []) || []),
    ];

    const failed = checks.filter((c) => !c.ok);
    for (const c of checks) {
        console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    }

    // Persist a JSON report next to the runner if REPORT_DIR is set by caller
    return {
        ok: failed.length === 0,
        checks,
        ctx,
        error: failed.length ? failed.map((f) => f.name).join(', ') : undefined,
    };
};

export const writeReport = (reportDir: string, payload: unknown): void => {
    fs.mkdirSync(reportDir, { recursive: true });
    const file = path.join(reportDir, `report-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`Report: ${file}`);
};
