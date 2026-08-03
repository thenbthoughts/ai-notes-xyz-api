import { Router, Request, Response } from 'express';
import { ModelChatLlm } from '../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import getNextMessageFromLast30Conversation from './utils/getNextMessageFromLast25Conversation';
import { getApiKeyByObject } from '../../../utils/llm/llmCommonFunc';
import { normalizeDateTimeIpAddress } from '../../../utils/llm/normalizeDateTimeIpAddress';
import middlewareActionDatetime from '../../../middleware/middlewareActionDatetime';
import { ModelLlmPendingTaskCron } from '../../../schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema';
import { llmPendingTaskTypes } from '../../../utils/llmPendingTask/llmPendingTaskConstants';
import { ModelChatLlmThread } from '../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { getMongodbObjectOrNull } from '../../../utils/common/getMongodbObjectOrNull';

import answerMachineInitiateFuncV4 from './answerMachineV4/answerMachineInitiateFuncV4';
import agentInitiateFunc from './agent/agentInitiateFunc';
import { runChatShellForThread } from './shellExecute/runChatShellForThread';

// Router
const router = Router();

const generateTags = async ({
    mongodbRecordId,
    auth_userId,
}: {
    mongodbRecordId: string,
    auth_userId: string,
}) => {
    try {
        await ModelLlmPendingTaskCron.create({
            userId: auth_userId,
            taskType: llmPendingTaskTypes.page.featureAiActions.chatMessage,
            targetRecordId: mongodbRecordId,
        });
    } catch (error) {
        console.error(error);
    }
};

// Add Note API
router.post(
    '/notesAddAutoNextMessage',
    middlewareUserAuth,
    middlewareActionDatetime,
       async (req: Request, res: Response) => {
        const abortController = new AbortController();
        const abortIfClientGone = () => {
            if (!res.writableEnded) {
                abortController.abort();
            }
        };
        req.on('close', abortIfClientGone);
        try {
            const auth_userId = res.locals.auth_userId;
            const apiKeys = getApiKeyByObject(res.locals.apiKey);

            // variable -> threadId
            let threadId = getMongodbObjectOrNull(req.body.threadId);
            if (threadId === null) {
                return res.status(400).json({ message: 'Thread ID cannot be null' });
            }

            // get thread info
            const threadInfo = await ModelChatLlmThread.findOne({
                _id: threadId,
                userId: auth_userId,
            });
            if (!threadInfo) {
                return res.status(400).json({ message: 'Thread not found' });
            }
            
            if (threadInfo.executeShell) {
                const actionDatetimeObj = normalizeDateTimeIpAddress({
                    ...res.locals.actionDatetime,
                    createdAtUtc: new Date().toISOString(),
                    updatedAtUtc: new Date().toISOString(),
                });
                const shellRes = await runChatShellForThread({
                    threadId,
                    userId: auth_userId,
                    actionDatetimeObj,
                });
                if (!shellRes.success) {
                    return res.status(400).json({ message: shellRes.error });
                }
            }

            // does thread have personal context enabled?

            // generate Feature AI Actions by source id (includes FAQ, Summary, Tags, Title, Embedding)
            await ModelLlmPendingTaskCron.create({
                userId: auth_userId,
                taskType: llmPendingTaskTypes.page.featureAiActions.chatThread,
                targetRecordId: threadId,
            });

            let aiModelProvider = threadInfo.aiModelProvider as 'groq' | 'openrouter' | 'ollama' | 'localai' | 'openai-compatible';
            let aiModelName = threadInfo.aiModelName;
            let llmAuthToken = '';
            let llmEndpoint = '';
            if (aiModelProvider === 'groq') {
                llmAuthToken = apiKeys.apiKeyGroq;
                llmEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
            } else if (aiModelProvider === 'openrouter') {
                llmAuthToken = apiKeys.apiKeyOpenrouter;
                llmEndpoint = 'https://openrouter.ai/api/v1/chat/completions';
            }

            // Create initial message record
            const actionDatetimeObj2 = normalizeDateTimeIpAddress({
                ...res.locals.actionDatetime,
                createdAtUtc: new Date().toISOString(),
                updatedAtUtc: new Date().toISOString(),
            });
            const resultFromLastConversation = await ModelChatLlm.create({
                type: 'text',
                content: 'AI generating in progress...',
                userId: res.locals.auth_userId,
                tags: [],
                fileUrl: '',
                fileUrlArr: '',
                threadId,
                isAi: true,
                aiModelProvider: aiModelProvider,
                aiModelName: aiModelName,
                ...actionDatetimeObj2,
            });

            const messageId = resultFromLastConversation._id;

            if (
                aiModelProvider === 'groq' ||
                aiModelProvider === 'openrouter' ||
                aiModelProvider === 'ollama' ||
                aiModelProvider === 'localai' ||
                aiModelProvider === 'openai-compatible'
            ) {
                await getNextMessageFromLast30Conversation({
                    threadId,
                    threadInfo,
                    userId: res.locals.auth_userId,
                    aiModelProvider: aiModelProvider,
                    aiModelName: aiModelName,
                    userApiKey: apiKeys,
                    messageId: messageId,
                    abortSignal: abortController.signal,
                });

                if (!abortController.signal.aborted) {
                    await generateTags({
                        mongodbRecordId: messageId.toString(),
                        auth_userId,
                    });
                }
            }

            if (!abortController.signal.aborted && !res.writableEnded) {
                return res.status(200).json({ message: 'Success' });
            }
            return;
        } catch (error) {
            if (abortController.signal.aborted) {
                return;
            }
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        } finally {
            req.off('close', abortIfClientGone);
        }
    }
);

// Answer Machine 4 (OpenCode + Shell file bridge)
router.post(
    '/answerMachineV4',
    middlewareUserAuth,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        const abortController = new AbortController();
        const abortIfClientGone = () => {
            if (!res.writableEnded) {
                abortController.abort();
            }
        };
        req.on('close', abortIfClientGone);
        try {
            const auth_userId = res.locals.auth_userId;

            let threadId = getMongodbObjectOrNull(req.body.threadId);
            if (threadId === null) {
                return res.status(400).json({ message: 'Thread ID cannot be null' });
            }

            const lastMessage = await ModelChatLlm.findOne({
                threadId: threadId,
                userId: auth_userId,
                isAi: false,
            }).sort({ createdAtUtc: -1 });
            if (!lastMessage) {
                return res.status(400).json({ message: 'Last message not found' });
            }

            const result = await answerMachineInitiateFuncV4({
                messageId: lastMessage._id,
                abortSignal: abortController.signal,
            });

            if (result.success === false) {
                return res.status(500).json({ message: 'Server error', error: result.errorReason });
            }

            if (!abortController.signal.aborted && !res.writableEnded) {
                return res.status(200).json({ message: 'Success' });
            }
            return;
        } catch (error) {
            if (abortController.signal.aborted) {
                return;
            }
            console.error(error);
            return res.status(500).json({ message: 'Server error', error: error });
        } finally {
            req.off('close', abortIfClientGone);
        }
    }
);

// Agent (background infinite loop with goals + polling)
router.post(
    '/agent',
    middlewareUserAuth,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        try {
            const auth_userId = res.locals.auth_userId;

            let threadId = getMongodbObjectOrNull(req.body.threadId);
            if (threadId === null) {
                return res.status(400).json({ message: 'Thread ID cannot be null' });
            }

            const lastMessage = await ModelChatLlm.findOne({
                threadId: threadId,
                userId: auth_userId,
                isAi: false,
            }).sort({ createdAtUtc: -1 });
            if (!lastMessage) {
                return res.status(400).json({ message: 'Last message not found' });
            }

            const result = await agentInitiateFunc({
                messageId: lastMessage._id,
            });

            if (result.success === false) {
                return res.status(500).json({ message: 'Server error', error: result.errorReason });
            }

            return res.status(200).json({
                message: 'Success',
                agentInstanceId: result.agentInstanceId,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error', error: error });
        }
    }
);

export default router;