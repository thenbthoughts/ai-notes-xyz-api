import { Router, Request, Response } from 'express';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import getNextQuestionsFromLast30Conversation from './utils/getNextQuestionsFromLast30Conversation';
import { getApiKeyByObject } from '../../utils/llm/llmCommonFunc';

// Router
const router = Router();

// Add Task API
router.post('/notesNextQuestionGenerateByLast30Conversation', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
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