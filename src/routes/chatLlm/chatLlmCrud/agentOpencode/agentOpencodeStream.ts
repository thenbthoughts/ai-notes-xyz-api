import type { Request, Response } from 'express';

import { ModelAgentOpencodeInstance } from '../../../../schema/schemaChatLlm/SchemaAgentOpencode/SchemaAgentOpencodeInstance.schema';
import { ModelChatLlmThread } from '../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelUserApiKey } from '../../../../schema/schemaUser/SchemaUserApiKey.schema';
import { getMongodbObjectOrNull } from '../../../../utils/common/getMongodbObjectOrNull';
import { getApiKeyByObject } from '../../../../utils/llm/llmCommonFunc';
import { ANSWER_ENGINE_AGENT_OPENCODE } from './agentOpencodeConstants';
import {
    agentOpencodeReadFile,
    agentOpencodeWorkspacePaths,
    getAgentOpencodeShellConfig,
} from './agentOpencodeWorkspace';
import {
    isOpencodeSessionId,
    opencodeExportSessionViaShell,
} from './agentOpencodeServer';

const sseWrite = (res: Response, event: string, data: unknown): void => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    res.write(payload);
};

/**
 * SSE stream for opencode — export by session id every second.
 * Frontend fetches /api/chat-llm/agent-opencode/stream?threadId=...
 * Every second it exports the opencode session (GET /session/:id/message via shell curl)
 * and also reads ANSWER.md as fallback. It watches instance status; when not pending it closes.
 * This gives the user a live view while opencode is thinking/writing files.
 */
export const handleAgentOpencodeStream = async (req: Request, res: Response): Promise<void> => {
    const auth_userId = (res.locals as Record<string, unknown>).auth_userId as string;
    const threadIdRaw = typeof req.query.threadId === 'string' ? req.query.threadId : String(req.query.threadId || '');
    const threadId = getMongodbObjectOrNull(threadIdRaw);

    if (threadId === null) {
        res.status(400).json({ message: 'Thread ID cannot be null' });
        return;
    }

    // Verify thread belongs to user and is opencode
    const thread = await ModelChatLlmThread.findOne({
        _id: threadId,
        userId: auth_userId,
    })
        .select('answerEngine')
        .lean();
    if (!thread) {
        res.status(404).json({ message: 'Thread not found' });
        return;
    }
    if ((thread as Record<string, unknown>).answerEngine !== ANSWER_ENGINE_AGENT_OPENCODE) {
        res.status(400).json({ message: 'Thread is not Agent (Opencode)' });
        return;
    }

    const apiKeyDoc = await ModelUserApiKey.findOne({ userId: auth_userId });
    const apiKeys = getApiKeyByObject(apiKeyDoc);
    const shell = getAgentOpencodeShellConfig(apiKeys);
    if (!shell) {
        res.status(400).json({ message: 'Agent Workspace not configured' });
        return;
    }

    // Setup SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    // For fetch streaming, also allow CORS if needed
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    // Send initial comment to keep connection alive
    res.write(': connected\n\n');
    if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
        (res as unknown as { flush: () => void }).flush!();
    }

    let closed = false;
    let timer: NodeJS.Timeout | null = null;
    let pollCount = 0;
    const maxPolls = 600; // 600 * 1000ms = 10 minutes max per connection
    let lastContent = '';
    let lastExport = '';

    const cleanup = (): void => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        try {
            res.end();
        } catch {
            // ignore
        }
    };

    req.on('close', () => {
        cleanup();
    });
    req.on('aborted', () => {
        cleanup();
    });

    const tick = async (): Promise<void> => {
        if (closed) return;
        pollCount += 1;
        if (pollCount > maxPolls) {
            sseWrite(res, 'end', { reason: 'timeout' });
            cleanup();
            return;
        }

        try {
            const latest = await ModelAgentOpencodeInstance.findOne({
                threadId,
                userId: auth_userId,
            })
                .sort({ createdAtUtc: -1 })
                .lean();

            const status = latest && typeof (latest as Record<string, unknown>).status === 'string'
                ? String((latest as Record<string, unknown>).status)
                : '';
            const pipelineStep = latest && typeof (latest as Record<string, unknown>).pipelineStep === 'string'
                ? String((latest as Record<string, unknown>).pipelineStep)
                : '';
            const instanceId = latest && (latest as Record<string, unknown>)._id
                ? String((latest as Record<string, unknown>)._id)
                : '';

            // Stream via opencode export by session id every second, fallback to ANSWER.md
            let content = '';
            let exportText = '';
            let readError = '';
            let sessionId = '';
            // Resolve session id from thread or latest instance
            const threadRow = await ModelChatLlmThread.findById(threadId).select('opencodeSessionId').lean();
            const fromThread = threadRow && typeof (threadRow as Record<string, unknown>).opencodeSessionId === 'string'
                ? String((threadRow as Record<string, unknown>).opencodeSessionId).trim()
                : '';
            const fromInstance = latest && typeof (latest as Record<string, unknown>).opencodeRunId === 'string'
                ? String((latest as Record<string, unknown>).opencodeRunId).trim()
                : '';
            if (isOpencodeSessionId(fromThread)) sessionId = fromThread;
            else if (isOpencodeSessionId(fromInstance)) sessionId = fromInstance;

            if (sessionId) {
                try {
                    const paths = agentOpencodeWorkspacePaths({
                        threadId: String(threadId),
                    });
                    const directory = paths.agentWorkspaceDir;
                    const exported = await opencodeExportSessionViaShell({
                        shell,
                        directory,
                        sessionId,
                    });
                    exportText = exported.exportText || '';
                } catch (err) {
                    readError = err instanceof Error ? err.message : String(err);
                }
            }

            // Also read ANSWER.md as fallback / complement
            let answerContent = '';
            if (latest) {
                const paths = agentOpencodeWorkspacePaths({
                    threadId: String(threadId),
                });
                try {
                    answerContent = await agentOpencodeReadFile({
                        shell,
                        relativePath: paths.outputPrompt,
                    });
                } catch (err) {
                    const e = err instanceof Error ? err.message : String(err);
                    if (!/not found|No such file/i.test(e)) readError = e;
                }
            }

            // Prefer session export if it has content, otherwise ANSWER.md
            if (exportText.trim()) content = exportText;
            else content = answerContent;

            const shouldSend = content !== lastContent || exportText !== lastExport || pollCount === 1;
            if (shouldSend) {
                lastContent = content;
                lastExport = exportText;
                sseWrite(res, 'chunk', {
                    content,
                    exportText,
                    answerContent,
                    status,
                    pipelineStep,
                    instanceId,
                    sessionId,
                    readError,
                    trunc: content.length > 20000 ? content.slice(0, 20000) + '\n\n…(truncated for stream)' : undefined,
                });
            } else {
                sseWrite(res, 'heartbeat', { status, pipelineStep, instanceId, sessionId });
            }

            if (latest && status !== 'pending' && status !== '') {
                sseWrite(res, 'done', { content, exportText, answerContent, status, pipelineStep, instanceId, sessionId });
                setTimeout(() => {
                    cleanup();
                }, 800);
                if (timer) clearInterval(timer);
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            sseWrite(res, 'error', { message: msg.slice(0, 500) });
        }
    };

    // Immediate tick then every second (as you asked)
    await tick();
    if (!closed) {
        timer = setInterval(() => {
            void tick();
        }, 1000);
    }
};
