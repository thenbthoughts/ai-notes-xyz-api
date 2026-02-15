import { Router, Request, Response } from 'express';
import { ModelChatLlm } from '../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import { ObjectId } from 'mongoose';
import mongoose from 'mongoose';
import getNextMessageFromLast30Conversation from './utils/getNextMessageFromLast25Conversation';
import { getApiKeyByObject } from '../../../utils/llm/llmCommonFunc';
import { normalizeDateTimeIpAddress } from '../../../utils/llm/normalizeDateTimeIpAddress';
import middlewareActionDatetime from '../../../middleware/middlewareActionDatetime';
import { ModelLlmPendingTaskCron } from '../../../schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema';
import { llmPendingTaskTypes } from '../../../utils/llmPendingTask/llmPendingTaskConstants';
import { ModelChatLlmThread } from '../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { getMongodbObjectOrNull } from '../../../utils/common/getMongodbObjectOrNull';

import answerMachineInitiateFunc from './answerMachineV2/answerMachineInitiateFunc';

// Router
const router = Router();

const generateTags = async ({
    mongodbRecordId,
    auth_username,
}: {
    mongodbRecordId: string,
    auth_username: string,
}) => {
    try {
        await ModelLlmPendingTaskCron.create({
            username: auth_username,
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
        try {
            const auth_username = res.locals.auth_username;
            const apiKeys = getApiKeyByObject(res.locals.apiKey);

            // variable -> threadId
            let threadId = getMongodbObjectOrNull(req.body.threadId);
            if (threadId === null) {
                return res.status(400).json({ message: 'Thread ID cannot be null' });
            }

            // get thread info
            const threadInfo = await ModelChatLlmThread.findOne({
                _id: threadId,
                username: auth_username,
            });
            if (!threadInfo) {
                return res.status(400).json({ message: 'Thread not found' });
            }

            // does thread have personal context enabled?
            const actionDatetimeObj = normalizeDateTimeIpAddress(res.locals.actionDatetime);

            // generate Feature AI Actions by source id (includes FAQ, Summary, Tags, Title, Embedding)
            await ModelLlmPendingTaskCron.create({
                username: auth_username,
                taskType: llmPendingTaskTypes.page.featureAiActions.chatThread,
                targetRecordId: threadId,
            });

            let aiModelProvider = threadInfo.aiModelProvider as 'groq' | 'openrouter';
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
            const resultFromLastConversation = await ModelChatLlm.create({
                type: 'text',
                content: 'AI generating in progress...',
                username: res.locals.auth_username,
                tags: [],
                fileUrl: '',
                fileUrlArr: '',
                threadId,
                isAi: true,
                aiModelProvider: aiModelProvider,
                aiModelName: aiModelName,
                ...actionDatetimeObj,
            });

            const messageId = resultFromLastConversation._id;

            if (
                aiModelProvider === 'groq' ||
                aiModelProvider === 'openrouter' ||
                aiModelProvider === 'ollama' ||
                aiModelProvider === 'openai-compatible'
            ) {
                await getNextMessageFromLast30Conversation({
                    threadId,
                    threadInfo,
                    username: res.locals.auth_username,
                    aiModelProvider: aiModelProvider,
                    aiModelName: aiModelName,
                    userApiKey: apiKeys,
                    messageId: messageId,
                });

                // Generate tags
                await generateTags({
                    mongodbRecordId: messageId.toString(),
                    auth_username,
                });
            }

            return res.status(200).json({ message: 'Success' });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Answer Machine API
router.post(
    '/answerMachine',
    middlewareUserAuth,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        try {
            const auth_username = res.locals.auth_username;

            // variable -> threadId
            let threadId = getMongodbObjectOrNull(req.body.threadId);
            if (threadId === null) {
                return res.status(400).json({ message: 'Thread ID cannot be null' });
            }

            // get last message in thread
            const lastMessage = await ModelChatLlm.findOne({
                threadId: threadId,
                username: auth_username,
                isAi: false,
            }).sort({ createdAt: -1 });
            if (!lastMessage) {
                return res.status(400).json({ message: 'Last message not found' });
            }
            const messageId = lastMessage._id;

            // answer machine
            const result = await answerMachineInitiateFunc({
                messageId: messageId,
            });

            if (result.success === false) {
                return res.status(500).json({ message: 'Server error', error: result.errorReason });
            }

            return res.status(200).json({ message: 'Success' });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error', error: error });
        }
    }
);
export default router;