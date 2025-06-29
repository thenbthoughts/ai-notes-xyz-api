import { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';
import { ModelTask } from '../../schema/schemaTask/SchemaTask.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import getTaskListByLast30Conversation from './utils/getTaskListByLast30Conversation';
import funcTasksGenerateByConversationId from './utils/funcTaskGenerateByConversationId';
import funcGetTaskAiSuggestionByTaskId from './utils/funcGetTaskAiSuggestionByTaskId';
import { getApiKeyByObject } from '../../utils/llm/llmCommonFunc';
import { ModelTaskComments } from '../../schema/schemaTask/SchemaTaskComments.schema';
import middlewareActionDatetime from '../../middleware/middlewareActionDatetime';
import { normalizeDateTimeIpAddress } from '../../utils/llm/normalizeDateTimeIpAddress';

// Router
const router = Router();

// taskGenerateByLast30Conversation
router.post('/taskGenerateByLast30Conversation', middlewareUserAuth, async (req: Request, res: Response) => {
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

        let taskList = [] as object[];
        if (provider === 'groq' || provider === 'openrouter') {
            taskList = await getTaskListByLast30Conversation({
                username: res.locals.auth_username,

                provider,
                llmAuthToken,
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

// taskGenerateByConversationId
router.post('/taskGenerateByConversationId', middlewareUserAuth, async (req: Request, res: Response) => {
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

        console.log(req.body.id)
        let taskList = [] as object[];
        if (provider === 'groq' || provider === 'openrouter') {
            taskList = await funcTasksGenerateByConversationId({
                _id: req.body.id,
                username: res.locals.auth_username,

                provider,
                llmAuthToken,
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

// taskAiSuggestionById
router.post(
    '/taskAiSuggestionById',
    middlewareUserAuth,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        try {
            const apiKeys = getApiKeyByObject(res.locals.apiKey);
            const actionDatetimeObj = normalizeDateTimeIpAddress(
                res.locals.actionDatetime
            );
            console.log(actionDatetimeObj);

            let provider = '' as 'groq' | 'openrouter' | '';
            let llmAuthToken = '';
            if (apiKeys.apiKeyGroqValid) {
                provider = 'groq';
                llmAuthToken = apiKeys.apiKeyGroq;
            } else if (apiKeys.apiKeyOpenrouterValid) {
                provider = 'openrouter';
                llmAuthToken = apiKeys.apiKeyOpenrouter;
            }

            const taskInfo = await funcGetTaskAiSuggestionByTaskId({
                taskRecordId: req.body.id,
                username: res.locals.auth_username,

                provider,
                llmAuthToken,
            });

            // add ai suggestion
            if (taskInfo.newTaskAiSuggestion.length >= 1) {
                await ModelTaskComments.create({
                    taskId: req.body.id,

                    commentText: taskInfo.newTaskAiSuggestion,
                    isAi: true,

                    username: res.locals.auth_username,

                    // date time ip
                    ...actionDatetimeObj,
                });
            }

            return res.status(201).json({
                success: 'Success',
                error: '',
                data: {
                    taskInfo,
                }
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);


export default router;