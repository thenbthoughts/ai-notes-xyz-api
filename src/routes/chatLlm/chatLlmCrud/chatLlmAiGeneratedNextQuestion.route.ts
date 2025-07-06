import { Router, Request, Response } from 'express';
import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import getNextQuestionsFromLast30Conversation from './utils/getNextQuestionsFromLast30Conversation';
import { getApiKeyByObject } from '../../../utils/llm/llmCommonFunc';
import mongoose from 'mongoose';
import { ModelChatLlmThread } from '../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';

// Router
const router = Router();

// Add Task API
router.post('/notesNextQuestionGenerateByLast30Conversation', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        // variable -> threadId
        let threadId = null as mongoose.Types.ObjectId | null;
        const arg_threadId = req.body.threadId;
        if (typeof req.body?.threadId === 'string') {
            threadId = req.body?.threadId ? mongoose.Types.ObjectId.createFromHexString(arg_threadId) : null;
        }
        if (threadId === null) {
            return res.status(400).json({ message: 'Thread ID cannot be null' });
        }

        // get thread info
        const threadInfo = await ModelChatLlmThread.findOne({
            _id: threadId,
            username: res.locals.auth_username,
        });
        if (!threadInfo) {
            return res.status(400).json({ message: 'Thread not found' });
        }

        const apiKeys = getApiKeyByObject(res.locals.apiKey);

        let provider = '';
        let llmAuthToken = '';
        if (apiKeys.apiKeyGroqValid) {
            provider = 'groq';
            llmAuthToken = apiKeys.apiKeyGroq;
        } else if (apiKeys.apiKeyOpenrouterValid) {
            provider = 'openrouter';
            llmAuthToken = apiKeys.apiKeyOpenrouter;
        }

        let taskList = [] as string[];
        if (provider === 'groq' || provider === 'openrouter') {
            taskList = await getNextQuestionsFromLast30Conversation({
                threadId,
                username: res.locals.auth_username,
                llmAuthToken,
                provider,
            });
        }

        return res.status(201).json({
            success: 'Success',
            error: '',
            data: {
                count: taskList.length,
                docs: taskList,
            }
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;