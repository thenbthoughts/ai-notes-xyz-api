import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../../middleware/middlewareUserAuth';

import { ModelChatLlmThreadContextReference } from '../../../schema/schemaChatLlm/SchemaChatLlmThreadContextReference.schema';
import middlewareActionDatetime from '../../../middleware/middlewareActionDatetime';
import { normalizeDateTimeIpAddress } from '../../../utils/llm/normalizeDateTimeIpAddress';
import { getMongodbObjectOrNull } from '../../../utils/common/getMongodbObjectOrNull';
import { getApiKeyByObject } from '../../../utils/llm/llmCommonFunc';
import selectAutoContextByThreadId from './utils/selectAutoContextByThreadId';
import searchContext from './utils/searchContext';

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
            if (['notes', 'tasks', 'chatLlm', 'lifeEvents', 'infoVault'].includes(updateObj.referenceFrom)) {
                // valid
            } else {
                return res.status(400).json({ message: 'Reference from is invalid. Valid values are: notes, tasks, chats, life-events, info-vaults' });
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

// Bulk Create Thread Context API
router.post(
    '/contextBulkUpsert',
    middlewareUserAuth,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        try {
            const actionDatetimeObj = normalizeDateTimeIpAddress(res.locals.actionDatetime);

            const {
                threadId,
                contexts,
            } = req.body;

            // Validate threadId
            const threadIdObj = getMongodbObjectOrNull(threadId);
            if (threadIdObj === null) {
                return res.status(400).json({ message: 'Thread ID is invalid' });
            }

            // Validate contexts array
            if (!Array.isArray(contexts) || contexts.length === 0) {
                return res.status(400).json({ message: 'Contexts must be a non-empty array' });
            }

            // Prepare bulk operations
            const bulkOps = [];
            for (const context of contexts) {
                const { referenceFrom, referenceId } = context;

                // Validate referenceId
                const referenceIdObj = getMongodbObjectOrNull(referenceId);
                if (referenceIdObj === null) {
                    continue; // Skip invalid reference IDs
                }

                // Validate referenceFrom
                if (!['notes', 'tasks', 'chatLlm', 'lifeEvents', 'infoVault'].includes(referenceFrom)) {
                    continue; // Skip invalid reference types
                }

                bulkOps.push({
                    updateOne: {
                        filter: {
                            username: res.locals.auth_username,
                            threadId: threadIdObj,
                            referenceId: referenceIdObj,
                        },
                        update: {
                            $set: {
                                threadId: threadIdObj,
                                referenceFrom: referenceFrom,
                                referenceId: referenceIdObj,
                                isAddedByAi: false,
                                username: res.locals.auth_username,
                                ...actionDatetimeObj,
                            }
                        },
                        upsert: true,
                    }
                });
            }

            if (bulkOps.length === 0) {
                return res.status(400).json({ message: 'No valid contexts to process' });
            }

            // Execute bulk write
            const result = await ModelChatLlmThreadContextReference.bulkWrite(bulkOps);

            return res.status(201).json({
                message: 'Bulk operation completed successfully',
                result: {
                    insertedCount: result.upsertedCount,
                    modifiedCount: result.modifiedCount,
                    matchedCount: result.matchedCount,
                },
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({
                message: 'Server error',
            });
        }
    }
);

// Bulk Delete Thread Context API
router.post(
    '/contextBulkDelete',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const {
                threadId,
                contextIds,
            } = req.body;

            // Validate threadId
            const threadIdObj = getMongodbObjectOrNull(threadId);
            if (threadIdObj === null) {
                return res.status(400).json({ message: 'Thread ID is invalid' });
            }

            // Validate contextIds array
            if (!Array.isArray(contextIds) || contextIds.length === 0) {
                return res.status(400).json({ message: 'Context IDs must be a non-empty array' });
            }

            // Convert contextIds to ObjectIds
            const contextIdObjs = contextIds
                .map(id => getMongodbObjectOrNull(id))
                .filter(id => id !== null) as mongoose.Types.ObjectId[];

            if (contextIdObjs.length === 0) {
                return res.status(400).json({ message: 'No valid context IDs to delete' });
            }

            // Delete contexts
            const result = await ModelChatLlmThreadContextReference.deleteMany({
                username: res.locals.auth_username,
                threadId: threadIdObj,
                _id: { $in: contextIdObjs },
            });

            return res.status(200).json({
                message: 'Bulk delete completed successfully',
                result: {
                    deletedCount: result.deletedCount,
                },
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
    '/contextSelectAutoContext',
    middlewareUserAuth,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        try {
            const { threadId } = req.body;

            const auth_username = res.locals.auth_username;
            const apiKeys = getApiKeyByObject(res.locals.apiKey);

            const result = await selectAutoContextByThreadId({
                threadId,
                username: auth_username,
            });
            console.log('result selectAutoContextByThreadId', result);

            return res.json({
                message: 'Contexts selected successfully',
                // result,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({
                message: 'Server error',
            });
        }
    }
);

// Search Context API
router.post('/contextSearch', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const {
            // thread
            threadId,

            // filter
            searchQuery,
            filterEventTypeTasks,
            filterEventTypeLifeEvents,
            filterEventTypeNotes,
            filterEventTypeDiary,
            filterIsContextSelected,

            // filter -> task
            filterTaskIsCompleted,
            filterTaskIsArchived,
            filterTaskWorkspaceIds,

            // filter -> note
            filterNotesWorkspaceIds,

            // pagination
            page,
            limit,
         } = req.body;
        const auth_username = res.locals.auth_username;

        const result = await searchContext({
            username: auth_username,
            threadId: threadId,
            searchQuery: searchQuery,

            filterEventTypeTasks,
            filterEventTypeLifeEvents,
            filterEventTypeNotes,
            filterEventTypeDiary,
            filterIsContextSelected,
            // filterEventTypeInfoVault: false,

            // filter -> task
            filterTaskIsCompleted,
            filterTaskIsArchived,
            filterTaskWorkspaceIds,

            // filter -> note
            filterNotesWorkspaceIds,

            // pagination
            page,
            limit,
        });

        return res.json({
            message: 'Contexts searched successfully',
            result,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;