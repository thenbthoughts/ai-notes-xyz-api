import { Router, Request, Response } from 'express';
import { ModelChatLlm } from '../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import { ObjectId } from 'mongoose';
import getNextMessageFromLast30Conversation from './utils/getNextMessageFromLast25Conversation';
import { getApiKeyByObject } from '../../../utils/llm/llmCommonFunc';
import { normalizeDateTimeIpAddress } from '../../../utils/llm/normalizeDateTimeIpAddress';
import middlewareActionDatetime from '../../../middleware/middlewareActionDatetime';
import { ModelLlmPendingTaskCron } from '../../../schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema';
import { llmPendingTaskTypes } from '../../../utils/llmPendingTask/llmPendingTaskConstants';
import { ModelChatLlmThread } from '../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { getMongodbObjectOrNull } from '../../../utils/common/getMongodbObjectOrNull';

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
            taskType: llmPendingTaskTypes.page.chat.generateChatTagsById,
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

            // update title
            await ModelLlmPendingTaskCron.create({
                username: auth_username,
                taskType: llmPendingTaskTypes.page.chat.generateChatThreadTitleById,
                targetRecordId: threadId,
            });

            let aiModelProvider = threadInfo.aiModelProvider as 'groq' | 'openrouter';
            let aiModelName = threadInfo.aiModelName;
            let llmAuthToken = '';
            if (aiModelProvider === 'groq') {
                llmAuthToken = apiKeys.apiKeyGroq;
            } else if (aiModelProvider === 'openrouter') {
                llmAuthToken = apiKeys.apiKeyOpenrouter;
            }

            // process message
            if (aiModelProvider === 'groq' || aiModelProvider === 'openrouter') {
                const nextMessage = await getNextMessageFromLast30Conversation({
                    // identification
                    threadId,
                    threadInfo,
                    username: res.locals.auth_username,

                    // model name
                    aiModelProvider: aiModelProvider,
                    aiModelName: aiModelName,
                    userApiKey: apiKeys,
                });
                const resultFromLastConversation = await ModelChatLlm.create({
                    type: 'text',
                    content: `AI: ${nextMessage.nextMessage}`,
                    username: res.locals.auth_username,
                    tags: [],
                    fileUrl: '',
                    fileUrlArr: '',
                    threadId, // Added threadId here

                    // model name
                    isAi: true,
                    aiModelProvider: nextMessage.aiModelProvider,
                    aiModelName: nextMessage.aiModelName,

                    ...actionDatetimeObj,
                });
                // add tags
                await generateTags({
                    mongodbRecordId: (resultFromLastConversation._id as ObjectId).toString(),
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

export default router;