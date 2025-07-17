import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../../middleware/middlewareUserAuth';

import { ModelChatLlmThread } from '../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelChatLlm } from '../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelChatLlmThreadContextReference } from '../../../schema/schemaChatLlm/SchemaChatLlmThreadContextReference.schema';
import middlewareActionDatetime from '../../../middleware/middlewareActionDatetime';
import { normalizeDateTimeIpAddress } from '../../../utils/llm/normalizeDateTimeIpAddress';
import { getMongodbObjectOrNull } from '../../../utils/common/getMongodbObjectOrNull';
import selectAutoContextNotesByThreadId from './utils/selectAutoContextNotesByThreadId';
import { getApiKeyByObject } from '../../../utils/llm/llmCommonFunc';

// Router
const router = Router();

// Get Thread Context API
router.post('/contextGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let tempStage = {} as PipelineStage;
        const pipelineDocument = [] as PipelineStage[];
        const pipelineCount = [] as PipelineStage[];

        // args
        let page = 1;
        let perPage = 1000;

        // set arg -> page
        if (typeof req.body?.page === 'number') {
            if (req.body.page >= 1) {
                page = req.body.page;
            }
        }
        // set arg -> perPage
        if (typeof req.body?.perPage === 'number') {
            if (req.body.perPage >= 1) {
                perPage = req.body.perPage;
            }
        }

        // stage -> match -> auth
        tempStage = {
            $match: {
                username: res.locals.auth_username,
            }
        };
        pipelineDocument.push(tempStage);
        pipelineCount.push(tempStage);

        // stage -> match -> threadId
        const matchObj = {} as {
            threadId: mongoose.Types.ObjectId | null;
            referenceFrom: string;
            referenceId: mongoose.Types.ObjectId | null;
            isAddedByAi: boolean;
        };
        const arg_threadId = getMongodbObjectOrNull(req.body.threadId);
        if (arg_threadId) {
            matchObj.threadId = arg_threadId;
        }
        const arg_referenceFrom = req.body.referenceFrom;
        if (arg_referenceFrom) {
            matchObj.referenceFrom = arg_referenceFrom;
        }
        const arg_referenceId = getMongodbObjectOrNull(req.body.referenceId);
        if (arg_referenceId) {
            matchObj.referenceId = arg_referenceId;
        }
        const arg_isAddedByAi = req.body.isAddedByAi;
        if (typeof arg_isAddedByAi === 'boolean') {
            matchObj.isAddedByAi = arg_isAddedByAi;
        }
        if (Object.keys(matchObj).length > 0) {
            tempStage = {
                $match: matchObj,
            };
            pipelineDocument.push(tempStage);
            pipelineCount.push(tempStage);
        }

        // stage -> sort
        tempStage = {
            $sort: {
                createdAtUtc: -1,
            }
        };
        pipelineDocument.push(tempStage);
        pipelineCount.push(tempStage);

        // stage -> skip
        tempStage = {
            $skip: (page - 1) * perPage,
        };
        pipelineDocument.push(tempStage);

        // stage -> limit
        tempStage = {
            $limit: perPage,
        };
        pipelineDocument.push(tempStage);

        // pipeline
        const resultContexts = await ModelChatLlmThreadContextReference.aggregate(pipelineDocument);
        const resultCount = await ModelChatLlmThreadContextReference.aggregate(pipelineCount);

        return res.json({
            message: 'Contexts retrieved successfully',
            count: resultCount.length,
            docs: resultContexts,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Delete Thread Context API
router.post('/contextDeleteById', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        // variable -> recordId
        let recordId = getMongodbObjectOrNull(req.body.recordId);
        if (recordId === null) {
            return res.status(400).json({ message: 'Record ID cannot be null' });
        }

        const deletedRecord = await ModelChatLlmThreadContextReference.findOneAndDelete({
            _id: recordId,
            username: res.locals.auth_username
        });
        if (!deletedRecord) {
            return res.status(404).json({ message: 'Record not found' });
        }

        return res.json({ message: 'Record deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Create Thread Context API
router.post(
    '/contextUpsert',
    middlewareUserAuth,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        try {
            const actionDatetimeObj = normalizeDateTimeIpAddress(res.locals.actionDatetime);

            const {
                threadId,
                referenceFrom,
                referenceId,
                isAddedByAi,
            } = req.body;

            let updateObj = {
                isAddedByAi: false,
            } as {
                threadId: mongoose.Types.ObjectId | null;
                referenceFrom: string;
                referenceId: mongoose.Types.ObjectId | null;
                isAddedByAi: boolean;
            };
            if (typeof threadId === 'string') {
                let threadIdObj = null as mongoose.Types.ObjectId | null;
                threadIdObj = threadId ? mongoose.Types.ObjectId.createFromHexString(threadId) : null;
                updateObj.threadId = threadIdObj;
            }
            if (typeof referenceFrom === 'string') {
                updateObj.referenceFrom = referenceFrom;
            }
            if (typeof referenceId === 'string') {
                let referenceIdObj = null as mongoose.Types.ObjectId | null;
                referenceIdObj = referenceId ? mongoose.Types.ObjectId.createFromHexString(referenceId) : null;
                updateObj.referenceId = referenceIdObj;
            }
            if (typeof isAddedByAi === 'boolean') {
                updateObj.isAddedByAi = isAddedByAi;
            }

            // validation
            if (updateObj.threadId === null) {
                return res.status(400).json({ message: 'Thread ID cannot be null' });
            }
            if (updateObj.referenceId === null) {
                return res.status(400).json({ message: 'Reference ID cannot be null' });
            }
            if (['note', 'task', 'chat', 'memo', 'life-event', 'info-vault'].includes(updateObj.referenceFrom)) {
                // valid
            } else {
                return res.status(400).json({ message: 'Reference from is invalid. Valid values are: note, task, chat, memo, life-event, info-vault' });
            }

            const existingContext = await ModelChatLlmThreadContextReference.findOne({
                // identification
                threadId: updateObj.threadId,

                // fields
                referenceFrom: updateObj.referenceFrom,
                referenceId: updateObj.referenceId,

                // auth
                username: res.locals.auth_username,
            });

            let newRecord;
            if (existingContext) {
                // Update existing context
                newRecord = await ModelChatLlmThreadContextReference.findByIdAndUpdate(
                    existingContext._id,
                    {
                        ...updateObj,
                        username: res.locals.auth_username,
                        ...actionDatetimeObj,
                    },
                    { new: true }
                );
            } else {
                // Create new context
                newRecord = await ModelChatLlmThreadContextReference.create({
                    ...updateObj,
                    username: res.locals.auth_username,
                    ...actionDatetimeObj,
                });
            }

            return res.status(201).json({
                message: 'Record created successfully',
                record: newRecord,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({
                message: 'Server error',
            });
        }
    }
);

// Select Auto Context Notes by Thread ID API
router.post(
    '/contextSelectAutoContextNotes',
    middlewareUserAuth,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        try {
            const { threadId } = req.body;

            const auth_username = res.locals.auth_username;
            const apiKeys = getApiKeyByObject(res.locals.apiKey);
            
            let aiModelProvider = '' as "groq" | "openrouter";
            let llmAuthToken = '';
            if (apiKeys.apiKeyOpenrouterValid) {
                aiModelProvider = 'openrouter';
                llmAuthToken = apiKeys.apiKeyOpenrouter;
            } else if (apiKeys.apiKeyGroqValid) {
                aiModelProvider = 'groq';
                llmAuthToken = apiKeys.apiKeyGroq;
            } else {
                return res.status(400).json({
                    message: 'No API key found',
                });
            }

            const threadIdObj = getMongodbObjectOrNull(threadId);
            if (threadIdObj === null) {
                return res.status(400).json({
                    message: 'Thread ID is invalid',
                });
            }

            const result = await selectAutoContextNotesByThreadId({
                threadId: threadIdObj,
                username: auth_username,
                llmAuthToken,
                provider: aiModelProvider,
            });

            return res.json({
                message: 'Contexts selected successfully',
                result,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({
                message: 'Server error',
            });
        }
    }
);

export default router;