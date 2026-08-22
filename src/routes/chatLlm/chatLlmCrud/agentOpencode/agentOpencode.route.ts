import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../../../middleware/middlewareUserAuth';
import middlewareActionDatetime from '../../../../middleware/middlewareActionDatetime';
import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelChatLlmThread } from '../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelAgentOpencodeInstance } from '../../../../schema/schemaChatLlm/SchemaAgentOpencode/SchemaAgentOpencodeInstance.schema';
import { ModelUserApiKey } from '../../../../schema/schemaUser/SchemaUserApiKey.schema';
import { getMongodbObjectOrNull } from '../../../../utils/common/getMongodbObjectOrNull';
import { getApiKeyByObject } from '../../../../utils/llm/llmCommonFunc';
import {
    getLibreOfficeConfig,
    libreOfficeDesktopAuthUrl,
} from '../../../../utils/libreOffice/libreOfficeConfig';
import agentOpencodeInitiate from './agentOpencodeInitiate';
import { serializeAgentOpencodeInstance } from './agentOpencodeSerialize';
import {
    agentOpencodeOpenSessionOnDesktop,
    agentOpencodeWorkspacePaths,
    getAgentOpencodeShellConfig,
    isOpencodeSessionId,
} from './agentOpencodeWorkspace';
import { ANSWER_ENGINE_AGENT_OPENCODE } from './agentOpencodeConstants';

const router = Router();

router.post(
    '/init',
    middlewareUserAuth,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        try {
            const auth_userId = res.locals.auth_userId;

            const threadId = getMongodbObjectOrNull(req.body.threadId);
            if (threadId === null) {
                return res.status(400).json({ message: 'Thread ID cannot be null' });
            }

            const lastMessage = await ModelChatLlm.findOne({
                threadId,
                userId: auth_userId,
                isAi: false,
            }).sort({ createdAtUtc: -1 });
            if (!lastMessage) {
                return res.status(400).json({ message: 'Last message not found' });
            }

            const result = await agentOpencodeInitiate({
                messageId: lastMessage._id,
            });

            if (result.success === false) {
                return res.status(500).json({ message: 'Server error', error: result.errorReason });
            }

            return res.status(200).json({
                message: 'Success',
                agentOpencodeInstanceId: result.agentOpencodeInstanceId,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error', error: error });
        }
    }
);

router.post(
    '/status',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const auth_userId = res.locals.auth_userId;
            const threadId = getMongodbObjectOrNull(req.body.threadId);
            if (threadId === null) {
                return res.status(400).json({ message: 'Thread ID cannot be null' });
            }

            const thread = await ModelChatLlmThread.findOne({
                _id: threadId,
                userId: auth_userId,
            })
                .select('opencodeSessionId')
                .lean();

            const docs = await ModelAgentOpencodeInstance.find({
                threadId,
                userId: auth_userId,
            })
                .sort({ createdAtUtc: -1 })
                .limit(40)
                .lean();

            const instances = docs.map((doc, index) =>
                serializeAgentOpencodeInstance(doc, {
                    isLatest: index === 0,
                    promptLimit: 160,
                })
            );
            const latest = instances[0] || null;
            const fromThread =
                thread && typeof thread.opencodeSessionId === 'string' ? thread.opencodeSessionId : '';
            const opencodeSessionId = isOpencodeSessionId(fromThread)
                ? fromThread
                : latest?.opencodeRunId || '';

            return res.status(200).json({
                success: true,
                status: latest?.status || null,
                agentOpencodeInstanceId: latest?.id || null,
                pipelineStep: latest?.pipelineStep || '',
                opencodeSessionId,
                instances,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error', error: error });
        }
    }
);

router.post(
    '/instance-list',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const auth_userId = res.locals.auth_userId;
            const threadId = getMongodbObjectOrNull(req.body.threadId);
            if (threadId === null) {
                return res.status(400).json({ message: 'Thread ID cannot be null' });
            }

            const docs = await ModelAgentOpencodeInstance.find({
                threadId,
                userId: auth_userId,
            })
                .sort({ createdAtUtc: -1 })
                .limit(40)
                .lean();

            return res.status(200).json({
                success: true,
                instances: docs.map((doc, index) =>
                    serializeAgentOpencodeInstance(doc, {
                        isLatest: index === 0,
                        promptLimit: 160,
                    })
                ),
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error', error: error });
        }
    }
);

router.post(
    '/instance-by-id',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const auth_userId = res.locals.auth_userId;
            const threadId = getMongodbObjectOrNull(req.body.threadId);
            const instanceId = getMongodbObjectOrNull(req.body.instanceId);
            if (threadId === null || instanceId === null) {
                return res.status(400).json({ message: 'Thread ID and instance ID are required' });
            }

            const doc = await ModelAgentOpencodeInstance.findOne({
                _id: instanceId,
                threadId,
                userId: auth_userId,
            }).lean();
            if (!doc) {
                return res.status(404).json({ message: 'Instance not found' });
            }

            let outputContent = '';
            if (doc.chatMessageId) {
                const chat = await ModelChatLlm.findById(doc.chatMessageId).select('content').lean();
                if (chat && typeof chat.content === 'string') {
                    outputContent = chat.content;
                }
            }

            const latest = await ModelAgentOpencodeInstance.findOne({
                threadId,
                userId: auth_userId,
            })
                .sort({ createdAtUtc: -1 })
                .select('_id')
                .lean();

            return res.status(200).json({
                success: true,
                instance: serializeAgentOpencodeInstance(doc, {
                    isLatest: latest ? String(latest._id) === String(doc._id) : false,
                    outputContent,
                }),
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error', error: error });
        }
    }
);

router.post(
    '/open-session',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const auth_userId = res.locals.auth_userId;
            const threadId = getMongodbObjectOrNull(req.body.threadId);
            if (threadId === null) {
                return res.status(400).json({ message: 'Thread ID cannot be null' });
            }

            const thread = await ModelChatLlmThread.findOne({
                _id: threadId,
                userId: auth_userId,
            }).lean();
            if (!thread) {
                return res.status(404).json({ message: 'Thread not found' });
            }
            if (thread.answerEngine !== ANSWER_ENGINE_AGENT_OPENCODE) {
                return res.status(400).json({ message: 'Thread is not Agent (Opencode)' });
            }

            const apiKeyDoc = await ModelUserApiKey.findOne({ userId: auth_userId });
            if (!apiKeyDoc) {
                return res.status(400).json({ message: 'User API keys not found' });
            }
            const apiKey = getApiKeyByObject(apiKeyDoc);
            const shell = getAgentOpencodeShellConfig(apiKey);
            if (!shell) {
                return res.status(400).json({
                    message: 'Agent Workspace is not configured. Add a valid Agent Workspace API URL and token in Settings.',
                });
            }

            const latest = await ModelAgentOpencodeInstance.findOne({
                threadId,
                userId: auth_userId,
            })
                .sort({ createdAtUtc: -1 })
                .lean();

            const fromThread =
                typeof thread.opencodeSessionId === 'string' ? thread.opencodeSessionId.trim() : '';
            const fromInstance =
                latest && typeof latest.opencodeRunId === 'string' ? latest.opencodeRunId.trim() : '';
            const sessionId = isOpencodeSessionId(fromThread)
                ? fromThread
                : isOpencodeSessionId(fromInstance)
                  ? fromInstance
                  : '';

            const relativeDir =
                (latest && typeof latest.agentWorkspaceRelativePath === 'string'
                    ? latest.agentWorkspaceRelativePath.trim()
                    : '') ||
                agentOpencodeWorkspacePaths({
                    threadId: String(threadId),
                    instanceId: latest ? String(latest._id) : String(threadId),
                }).agentWorkspaceDir;

            const opened = await agentOpencodeOpenSessionOnDesktop({
                shell,
                relativeDir,
                sessionId,
            });
            if (!opened.ok) {
                return res.status(400).json({
                    message: opened.error || 'Failed to open OpenCode session on the virtual computer',
                    sessionId,
                    relativeDir,
                });
            }

            const workspace = getLibreOfficeConfig(apiKey);
            const desktopUrl = workspace ? `${workspace.desktopUrl}/` : '';
            const desktopAuthUrl = workspace
                ? libreOfficeDesktopAuthUrl({
                      desktopUrl,
                      username: workspace.basicAuthUsername,
                      password: workspace.basicAuthPassword,
                  })
                : '';

            // Build Opencode web URL for browser: http://localhost:4096/server/<base64>/session/<id>
            // aHR0cDovL2xvY2FsaG9zdDo0MDk2 is base64 of http://localhost:4096 (no padding)
            const opencodeHost = process.env.OPENCODE_PORT ? `http://localhost:${process.env.OPENCODE_PORT}` : 'http://localhost:4096';
            const base64Server = Buffer.from(opencodeHost).toString('base64').replace(/=+$/, '');
            const opencodeWebUrl =
                (opened as any).webUrl ||
                (sessionId
                    ? `${opencodeHost}/server/${base64Server}/session/${sessionId}`
                    : `${opencodeHost}/`);

            return res.status(200).json({
                success: true,
                message: sessionId
                    ? `Opened OpenCode session ${sessionId} on the virtual computer`
                    : 'Opened OpenCode on the virtual computer',
                sessionId,
                relativeDir,
                desktopUrl,
                desktopAuthUrl,
                opencodeWebUrl,
                webUrl: (opened as any).webUrl || opencodeWebUrl,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error', error: error });
        }
    }
);

export default router;
