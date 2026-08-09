import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../../middleware/middlewareUserAuth';

import { ModelChatLlmThread } from '../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelChatLlm } from '../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import middlewareActionDatetime from '../../../middleware/middlewareActionDatetime';
import { normalizeDateTimeIpAddress } from '../../../utils/llm/normalizeDateTimeIpAddress';
import { ModelChatLlmThreadContextReference } from '../../../schema/schemaChatLlm/SchemaChatLlmThreadContextReference.schema';
import { systemPromptForChatLlmThread } from './constantsChatLlmThread/constantsChatLlmThread';
import { reindexDocument } from '../../../utils/search/reindexGlobalSearch';
import { deleteFilesByParentEntityId } from '../../upload/uploadFileS3ForFeatures';
import { getMongodbObjectOrNull } from '../../../utils/common/getMongodbObjectOrNull';

// Router
const router = Router();

// Get Note API
router.post('/threadsGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        // args
        let page = 1;
        let perPage = 20;

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

        let tempStage = {} as PipelineStage;
        const stateDocument = [] as PipelineStage[];
        const stateCount = [] as PipelineStage[];

        // stateDocument -> match
        tempStage = {
            $match: {
                userId: res.locals.auth_userId,
            } as {
                userId: string;
                isFavourite?: boolean;
            }
        }
        if (typeof req.body?.isFavourite === 'string') {
            if (req.body.isFavourite === 'true' || req.body.isFavourite === 'false') {
                tempStage.$match.isFavourite = req.body.isFavourite === 'true' ? true : false;
            }
        }
        stateDocument.push(tempStage);
        stateCount.push(tempStage);

        // stateDocument -> match -> search
        if (typeof req.body?.search === 'string') {
            if (req.body.search.length >= 1) {
                // lookup -> chatLlm
                tempStage = {
                    $lookup: {
                        from: 'chatLlm',
                        localField: '_id',
                        foreignField: 'threadId',
                        as: 'chatLlm',
                    }
                }
                stateDocument.push(tempStage);
                stateCount.push(tempStage);

                // search
                let searchQuery = req.body.search as string;

                let searchQueryArr = searchQuery
                    .replace('-', ' ')
                    .split(' ');

                const matchAnd = [];
                for (let index = 0; index < searchQueryArr.length; index++) {
                    const elementStr = searchQueryArr[index];
                    matchAnd.push({
                        $or: [
                            { threadTitle: { $regex: elementStr, $options: 'i' } },
                            { tagsAi: { $regex: elementStr, $options: 'i' } },
                            { aiSummary: { $regex: elementStr, $options: 'i' } },
                            { 'chatLlm.content': { $regex: elementStr, $options: 'i' } },
                        ]
                    })
                }

                tempStage = {
                    $match: {
                        $and: [
                            ...matchAnd,
                        ],
                    },
                };
                stateDocument.push(tempStage);
                stateCount.push(tempStage);
            }
        }

        // stateDocument -> match -> _id
        let threadId = null as mongoose.Types.ObjectId | null;
        const arg_threadId = req.body.threadId;
        if (typeof req.body?.threadId === 'string') {
            threadId = req.body?.threadId ? mongoose.Types.ObjectId.createFromHexString(arg_threadId) : null;
        }
        if (threadId !== null) {
            tempStage = {
                $match: {
                    _id: threadId,
                }
            }
            stateDocument.push(tempStage);
        }

        // stateDocument -> sort
        tempStage = {
            $sort: {
                createdAtUtc: -1,
            }
        }
        stateDocument.push(tempStage);
        stateCount.push(tempStage);

        // stage -> skip
        tempStage = {
            $skip: (page - 1) * perPage,
        };
        stateDocument.push(tempStage);

        // stage -> limit
        tempStage = {
            $limit: perPage,
        };
        stateDocument.push(tempStage);

        // stateCount -> count
        stateCount.push({
            $count: 'count'
        });

        // pipeline
        const resultThreads = await ModelChatLlmThread.aggregate(stateDocument);
        const resultCount = await ModelChatLlmThread.aggregate(stateCount);

        let totalCount = 0;
        if (resultCount.length === 1) {
            if (resultCount[0].count) {
                totalCount = resultCount[0].count;
            }
        }

        return res.json({
            message: 'Chat LLM Threads retrieved successfully',
            docs: resultThreads,
            count: totalCount,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Delete Note API
router.post('/threadsDeleteById', middlewareUserAuth, async (req: Request, res: Response) => {
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

        // delete all chat related to the thread
        await ModelChatLlm.deleteMany({
            userId: res.locals.auth_userId,
            threadId: threadId,
        });

        // delete all context related to the thread
        await ModelChatLlmThreadContextReference.deleteMany({
            userId: res.locals.auth_userId,
            threadId: threadId,
        });

        const deletedThread = await ModelChatLlmThread.findOneAndDelete({
            _id: threadId,
            userId: res.locals.auth_userId
        });
        if (!deletedThread) {
            return res.status(404).json({ message: 'Thread not found' });
        }

        await deleteFilesByParentEntityId({
            userId: res.locals.auth_userId,
            parentEntityId: threadId.toString(),
        });

        return res.json({ message: 'Thread deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Create Thread API
router.post(
    '/threadsAdd',
    middlewareUserAuth,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        try {
            const actionDatetimeObj = normalizeDateTimeIpAddress(res.locals.actionDatetime);

            const threadTitle = actionDatetimeObj.createdAtUtc?.toUTCString() || new Date().toString();

            const {
                isAutoAiContextSelectEnabled,
                isPersonalContextEnabled,
                isMemoryEnabled,

                // model settings
                aiModelName,
                aiModelProvider,
                aiModelOpenAiCompatibleConfigId,
                sttModelName,
                sttModelProvider,
                ttsModelName,
                ttsModelProvider,

                // classification
                isFavourite,

                // answer type
                answerEngine,

                // agent budgets
                agentMinBudgetTokens,
                agentMaxBudgetTokens,
                agentMinNumberOfIterations,
                agentMaxNumberOfIterations,

                executeShell,
                shellExecuteMinAttempts,
                shellExecuteMaxAttempts,
            } = req.body;

            const addData = {
                threadTitle: threadTitle.trim(),
                isAutoAiContextSelectEnabled: false,
                isPersonalContextEnabled: false,
                isMemoryEnabled: false,

                // model settings
                aiModelName: '',
                aiModelProvider: '',
                aiModelOpenAiCompatibleConfigId: null as mongoose.Types.ObjectId | null,
                sttModelName: '',
                sttModelProvider: '',
                ttsModelName: '',
                ttsModelProvider: '',

                // classification
                isFavourite: false,

                // answer type
                answerEngine: 'conciseAnswer',

                // agent budgets
                agentMinBudgetTokens: 1,
                agentMaxBudgetTokens: 1_000_000,
                agentMinNumberOfIterations: 1,
                agentMaxNumberOfIterations: 100,

                executeShell: false,
                shellExecuteMinAttempts: 1,
                shellExecuteMaxAttempts: 1,
            };

            if (typeof isAutoAiContextSelectEnabled === 'boolean') {
                addData.isAutoAiContextSelectEnabled = isAutoAiContextSelectEnabled;
            };

            if (typeof isPersonalContextEnabled === 'boolean') {
                addData.isPersonalContextEnabled = isPersonalContextEnabled;
            };

            if (typeof isMemoryEnabled === 'boolean') {
                addData.isMemoryEnabled = isMemoryEnabled;
            };

            if (typeof aiModelName === 'string') {
                addData.aiModelName = aiModelName;
            };

            if (typeof aiModelProvider === 'string') {
                addData.aiModelProvider = aiModelProvider;
            };

            if (typeof aiModelOpenAiCompatibleConfigId === 'string' && aiModelOpenAiCompatibleConfigId.length === 24) {
                addData.aiModelOpenAiCompatibleConfigId = getMongodbObjectOrNull(aiModelOpenAiCompatibleConfigId);
            };

            if (typeof sttModelName === 'string') {
                addData.sttModelName = sttModelName;
            };
            if (typeof sttModelProvider === 'string') {
                addData.sttModelProvider = sttModelProvider;
            };
            if (typeof ttsModelName === 'string') {
                addData.ttsModelName = ttsModelName;
            };
            if (typeof ttsModelProvider === 'string') {
                addData.ttsModelProvider = ttsModelProvider;
            };

            if (typeof isFavourite === 'boolean') {
                addData.isFavourite = isFavourite;
            };

            if (typeof answerEngine === 'string') {
                if (answerEngine === 'conciseAnswer' || answerEngine === 'agent') {
                    addData.answerEngine = answerEngine;
                }
            };

            if (typeof executeShell === 'boolean') {
                addData.executeShell = executeShell;
            };
            
            // Agent budgets: tokens (1–1M) and iterations (1–100), min <= max
            let minBudgetTokens: number | undefined = undefined;
            let maxBudgetTokens: number | undefined = undefined;
            let minIterations: number | undefined = undefined;
            let maxIterations: number | undefined = undefined;

            if (typeof agentMinBudgetTokens === 'number') {
                if (agentMinBudgetTokens >= 1 && agentMinBudgetTokens <= 1_000_000) {
                    minBudgetTokens = Math.round(agentMinBudgetTokens);
                }
            }
            if (typeof agentMaxBudgetTokens === 'number') {
                if (agentMaxBudgetTokens >= 1 && agentMaxBudgetTokens <= 1_000_000) {
                    maxBudgetTokens = Math.round(agentMaxBudgetTokens);
                }
            }
            if (minBudgetTokens !== undefined && maxBudgetTokens !== undefined) {
                if (minBudgetTokens <= maxBudgetTokens) {
                    addData.agentMinBudgetTokens = minBudgetTokens;
                    addData.agentMaxBudgetTokens = maxBudgetTokens;
                } else {
                    addData.agentMinBudgetTokens = maxBudgetTokens;
                    addData.agentMaxBudgetTokens = maxBudgetTokens;
                }
            } else if (minBudgetTokens !== undefined) {
                if (minBudgetTokens <= addData.agentMaxBudgetTokens) {
                    addData.agentMinBudgetTokens = minBudgetTokens;
                } else {
                    addData.agentMinBudgetTokens = minBudgetTokens;
                    addData.agentMaxBudgetTokens = minBudgetTokens;
                }
            } else if (maxBudgetTokens !== undefined) {
                if (addData.agentMinBudgetTokens <= maxBudgetTokens) {
                    addData.agentMaxBudgetTokens = maxBudgetTokens;
                } else {
                    addData.agentMinBudgetTokens = maxBudgetTokens;
                    addData.agentMaxBudgetTokens = maxBudgetTokens;
                }
            }
            
            if (typeof agentMinNumberOfIterations === 'number') {
                if (agentMinNumberOfIterations >= 1 && agentMinNumberOfIterations <= 100) {
                    minIterations = Math.round(agentMinNumberOfIterations);
                }
            }
            
            if (typeof agentMaxNumberOfIterations === 'number') {
                if (agentMaxNumberOfIterations >= 1 && agentMaxNumberOfIterations <= 100) {
                    maxIterations = Math.round(agentMaxNumberOfIterations);
                }
            }
            
            if (minIterations !== undefined && maxIterations !== undefined) {
                if (minIterations <= maxIterations) {
                    addData.agentMinNumberOfIterations = minIterations;
                    addData.agentMaxNumberOfIterations = maxIterations;
                } else {
                    addData.agentMinNumberOfIterations = maxIterations;
                    addData.agentMaxNumberOfIterations = maxIterations;
                }
            } else if (minIterations !== undefined) {
                if (minIterations <= addData.agentMaxNumberOfIterations) {
                    addData.agentMinNumberOfIterations = minIterations;
                } else {
                    addData.agentMinNumberOfIterations = minIterations;
                    addData.agentMaxNumberOfIterations = minIterations;
                }
            } else if (maxIterations !== undefined) {
                if (addData.agentMinNumberOfIterations <= maxIterations) {
                    addData.agentMaxNumberOfIterations = maxIterations;
                } else {
                    addData.agentMinNumberOfIterations = maxIterations;
                    addData.agentMaxNumberOfIterations = maxIterations;
                }
            };

            // Shell primary command retries (per thread), integers 1–10, min ≤ max
            let shellMinA: number | undefined = undefined;
            let shellMaxA: number | undefined = undefined;
            if (typeof shellExecuteMinAttempts === 'number' && Number.isInteger(shellExecuteMinAttempts)) {
                if (shellExecuteMinAttempts >= 1 && shellExecuteMinAttempts <= 10) {
                    shellMinA = shellExecuteMinAttempts;
                }
            }
            if (typeof shellExecuteMaxAttempts === 'number' && Number.isInteger(shellExecuteMaxAttempts)) {
                if (shellExecuteMaxAttempts >= 1 && shellExecuteMaxAttempts <= 10) {
                    shellMaxA = shellExecuteMaxAttempts;
                }
            }
            if (shellMinA !== undefined && shellMaxA !== undefined) {
                if (shellMinA <= shellMaxA) {
                    addData.shellExecuteMinAttempts = shellMinA;
                    addData.shellExecuteMaxAttempts = shellMaxA;
                } else {
                    addData.shellExecuteMinAttempts = shellMaxA;
                    addData.shellExecuteMaxAttempts = shellMaxA;
                }
            } else if (shellMinA !== undefined) {
                if (shellMinA <= addData.shellExecuteMaxAttempts) {
                    addData.shellExecuteMinAttempts = shellMinA;
                } else {
                    addData.shellExecuteMinAttempts = shellMinA;
                    addData.shellExecuteMaxAttempts = shellMinA;
                }
            } else if (shellMaxA !== undefined) {
                if (addData.shellExecuteMinAttempts <= shellMaxA) {
                    addData.shellExecuteMaxAttempts = shellMaxA;
                } else {
                    addData.shellExecuteMinAttempts = shellMaxA;
                    addData.shellExecuteMaxAttempts = shellMaxA;
                }
            }

            let systemPrompt = systemPromptForChatLlmThread;


            const newThread = await ModelChatLlmThread.create({
                // fields
                ...addData,

                // auth
                userId: res.locals.auth_userId,

                // created at
                ...actionDatetimeObj,

                systemPrompt,
            });

            // reindex for global search (non-blocking so create responds faster)
            void reindexDocument({
                reindexDocumentArr: [{
                    collectionName: 'chatLlmThread',
                    documentId: (newThread._id as mongoose.Types.ObjectId).toString(),
                }],
            }).catch((error) => {
                console.error('Error reindexing new chat thread:', error);
            });

            return res.status(201).json({ message: 'Thread created successfully', thread: newThread });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Edit Thread API
router.post(
    '/threadsEditById',
    middlewareUserAuth,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        try {
            const actionDatetimeObj = normalizeDateTimeIpAddress(res.locals.actionDatetime);

            // variable -> threadId
            let threadId = null as mongoose.Types.ObjectId | null;
            const arg_threadId = req.body.threadId;
            if (typeof req.body?.threadId === 'string') {
                threadId = req.body?.threadId ? mongoose.Types.ObjectId.createFromHexString(arg_threadId) : null;
            }
            if (threadId === null) {
                return res.status(400).json({ message: 'Thread ID cannot be null' });
            }

            // Extract fields to update
            const {
                threadTitle,
                isAutoAiContextSelectEnabled,
                isPersonalContextEnabled,
                isMemoryEnabled,

                // model settings
                aiModelName,
                aiModelProvider,
                aiModelOpenAiCompatibleConfigId,
                sttModelName,
                sttModelProvider,
                ttsModelName,
                ttsModelProvider,

                systemPrompt,

                chatLlmTemperature,
                chatLlmMaxTokens,

                chatMemoryLimit,

                // classification
                isFavourite,

                // answer type
                answerEngine,

                // agent budgets
                agentMinBudgetTokens,
                agentMaxBudgetTokens,
                agentMinNumberOfIterations,
                agentMaxNumberOfIterations,

                executeShell,

                shellExecuteMinAttempts,
                shellExecuteMaxAttempts,
            } = req.body;

            // Build update object
            const updateData: any = {};
            if (typeof threadTitle === 'string') {
                updateData.threadTitle = threadTitle
            };

            if (typeof isAutoAiContextSelectEnabled === 'boolean') {
                updateData.isAutoAiContextSelectEnabled = isAutoAiContextSelectEnabled;
            };

            if (typeof isPersonalContextEnabled === 'boolean') {
                updateData.isPersonalContextEnabled = isPersonalContextEnabled;
            };

            if (typeof isMemoryEnabled === 'boolean') {
                updateData.isMemoryEnabled = isMemoryEnabled;
            };

            if (typeof aiModelName === 'string') {
                updateData.aiModelName = aiModelName;
            };

            if (typeof aiModelProvider === 'string') {
                updateData.aiModelProvider = aiModelProvider;
            };

            if (typeof aiModelOpenAiCompatibleConfigId === 'string' && aiModelOpenAiCompatibleConfigId.length === 24) {
                updateData.aiModelOpenAiCompatibleConfigId = getMongodbObjectOrNull(aiModelOpenAiCompatibleConfigId);
            };

            if (typeof sttModelName === 'string') {
                updateData.sttModelName = sttModelName;
            };
            if (typeof sttModelProvider === 'string') {
                updateData.sttModelProvider = sttModelProvider;
            };
            if (typeof ttsModelName === 'string') {
                updateData.ttsModelName = ttsModelName;
            };
            if (typeof ttsModelProvider === 'string') {
                updateData.ttsModelProvider = ttsModelProvider;
            };

            if (typeof systemPrompt === 'string') {
                updateData.systemPrompt = systemPrompt;
            };

            if (typeof chatLlmTemperature === 'number') {
                if (chatLlmTemperature >= 0 && chatLlmTemperature <= 2) {
                    updateData.chatLlmTemperature = chatLlmTemperature;
                }
            };

            if (typeof chatLlmMaxTokens === 'number') {
                if (chatLlmMaxTokens >= 1) {
                    updateData.chatLlmMaxTokens = chatLlmMaxTokens;
                }
            };

            if (typeof chatMemoryLimit === 'number') {
                if (chatMemoryLimit >= 0) {
                    updateData.chatMemoryLimit = chatMemoryLimit;
                }
            };

            if (typeof isFavourite === 'boolean') {
                updateData.isFavourite = isFavourite;
            };

            if (typeof answerEngine === 'string') {
                if (answerEngine === 'conciseAnswer' || answerEngine === 'agent') {
                    updateData.answerEngine = answerEngine;
                }
            };

            if (typeof executeShell === 'boolean') {
                updateData.executeShell = executeShell;
            };
            
            // Agent budgets: tokens (1–1M) and iterations (1–100)
            let minBudgetTokens: number | undefined = undefined;
            let maxBudgetTokens: number | undefined = undefined;
            let minIterations: number | undefined = undefined;
            let maxIterations: number | undefined = undefined;

            if (typeof agentMinBudgetTokens === 'number') {
                if (agentMinBudgetTokens >= 1 && agentMinBudgetTokens <= 1_000_000) {
                    minBudgetTokens = Math.round(agentMinBudgetTokens);
                }
            }
            if (typeof agentMaxBudgetTokens === 'number') {
                if (agentMaxBudgetTokens >= 1 && agentMaxBudgetTokens <= 1_000_000) {
                    maxBudgetTokens = Math.round(agentMaxBudgetTokens);
                }
            }
            if (minBudgetTokens !== undefined || maxBudgetTokens !== undefined) {
                const existingThreadForBudget = await ModelChatLlmThread.findOne({
                    _id: threadId,
                    userId: res.locals.auth_userId,
                });
                const existingMinT = Math.min(
                    1_000_000,
                    Math.max(1, Math.round(Number(existingThreadForBudget?.agentMinBudgetTokens) || 1))
                );
                const existingMaxT = Math.min(
                    1_000_000,
                    Math.max(1, Math.round(Number(existingThreadForBudget?.agentMaxBudgetTokens) || 1_000_000))
                );
                const effMinT = minBudgetTokens !== undefined ? minBudgetTokens : existingMinT;
                const effMaxT = maxBudgetTokens !== undefined ? maxBudgetTokens : existingMaxT;
                if (effMinT <= effMaxT) {
                    updateData.agentMinBudgetTokens = effMinT;
                    updateData.agentMaxBudgetTokens = effMaxT;
                } else {
                    updateData.agentMinBudgetTokens = effMaxT;
                    updateData.agentMaxBudgetTokens = effMaxT;
                }
            }
            
            if (typeof agentMinNumberOfIterations === 'number') {
                if (agentMinNumberOfIterations >= 1 && agentMinNumberOfIterations <= 100) {
                    minIterations = Math.round(agentMinNumberOfIterations);
                }
            };
            
            if (typeof agentMaxNumberOfIterations === 'number') {
                if (agentMaxNumberOfIterations >= 1 && agentMaxNumberOfIterations <= 100) {
                    maxIterations = Math.round(agentMaxNumberOfIterations);
                }
            };
            
            if (minIterations !== undefined && maxIterations !== undefined) {
                if (minIterations <= maxIterations) {
                    updateData.agentMinNumberOfIterations = minIterations;
                    updateData.agentMaxNumberOfIterations = maxIterations;
                } else {
                    updateData.agentMinNumberOfIterations = maxIterations;
                    updateData.agentMaxNumberOfIterations = maxIterations;
                }
            } else if (minIterations !== undefined) {
                const existingThread = await ModelChatLlmThread.findOne({
                    _id: threadId,
                    userId: res.locals.auth_userId,
                });
                const existingMax = existingThread?.agentMaxNumberOfIterations || 100;
                if (minIterations <= existingMax) {
                    updateData.agentMinNumberOfIterations = minIterations;
                } else {
                    updateData.agentMinNumberOfIterations = minIterations;
                    updateData.agentMaxNumberOfIterations = minIterations;
                }
            } else if (maxIterations !== undefined) {
                const existingThread = await ModelChatLlmThread.findOne({
                    _id: threadId,
                    userId: res.locals.auth_userId,
                });
                const existingMin = existingThread?.agentMinNumberOfIterations || 1;
                if (existingMin <= maxIterations) {
                    updateData.agentMaxNumberOfIterations = maxIterations;
                } else {
                    updateData.agentMinNumberOfIterations = maxIterations;
                    updateData.agentMaxNumberOfIterations = maxIterations;
                }
            };

            let shellMinB: number | undefined = undefined;
            let shellMaxB: number | undefined = undefined;
            if (typeof shellExecuteMinAttempts === 'number' && Number.isInteger(shellExecuteMinAttempts)) {
                if (shellExecuteMinAttempts >= 1 && shellExecuteMinAttempts <= 10) {
                    shellMinB = shellExecuteMinAttempts;
                }
            }
            if (typeof shellExecuteMaxAttempts === 'number' && Number.isInteger(shellExecuteMaxAttempts)) {
                if (shellExecuteMaxAttempts >= 1 && shellExecuteMaxAttempts <= 10) {
                    shellMaxB = shellExecuteMaxAttempts;
                }
            }
            if (shellMinB !== undefined || shellMaxB !== undefined) {
                const existingShell = await ModelChatLlmThread.findOne({
                    _id: threadId,
                    userId: res.locals.auth_userId,
                });
                const existingShellMin = Math.min(
                    10,
                    Math.max(1, Math.round(Number(existingShell?.shellExecuteMinAttempts) || 1)),
                );
                const existingShellMax = Math.min(
                    10,
                    Math.max(1, Math.round(Number(existingShell?.shellExecuteMaxAttempts) || 1)),
                );
                const effMin = shellMinB !== undefined ? shellMinB : existingShellMin;
                const effMax = shellMaxB !== undefined ? shellMaxB : existingShellMax;
                if (effMin <= effMax) {
                    updateData.shellExecuteMinAttempts = effMin;
                    updateData.shellExecuteMaxAttempts = effMax;
                } else {
                    updateData.shellExecuteMinAttempts = effMax;
                    updateData.shellExecuteMaxAttempts = effMax;
                }
            }

            if (Object.keys(updateData).length === 0) {
                return res.status(400).json({ message: 'No valid fields provided for update' });
            }

            // Update timestamps and user agent info
            const actionDatetimeUpdateObj = {
                updatedAtUtc: actionDatetimeObj.updatedAtUtc,
                updatedAtIpAddress: actionDatetimeObj.updatedAtIpAddress,
                updatedAtUserAgent: actionDatetimeObj.updatedAtUserAgent,
            };

            const updatedThread = await ModelChatLlmThread.findOneAndUpdate(
                { _id: threadId, userId: res.locals.auth_userId },
                {
                    $set: {
                        ...updateData,
                        ...actionDatetimeUpdateObj,
                    }
                },
                { new: true }
            );

            if (!updatedThread) {
                return res.status(404).json({ message: 'Thread not found or not authorized' });
            }

            // reindex for global search
            await reindexDocument({
                reindexDocumentArr: [{
                    collectionName: 'chatLlmThread',
                    documentId: (updatedThread._id as mongoose.Types.ObjectId).toString(),
                }],
            });

            return res.json({ message: 'Thread updated successfully', thread: updatedThread });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Get Top LLM conversation model
router.get('/topLlmConversationModel', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const recentlyUsedLlm = await ModelChatLlmThread.aggregate([
            {
                $match: {
                    userId: res.locals.auth_userId,
                }
            },
            {
                $group: {
                    _id: {
                        aiModelProvider: '$aiModelProvider',
                        aiModelName: '$aiModelName'
                    },
                    updatedAtUtc: { $max: '$updatedAtUtc' }
                }
            },
            {
                $sort: {
                    updatedAtUtc: -1
                }
            },
            {
                $limit: 10
            },
            {
                $project: {
                    aiModelProvider: '$_id.aiModelProvider',
                    aiModelName: '$_id.aiModelName',
                }
            },
        ]) as {
            aiModelProvider: string;
            aiModelName: string;
        }[];

        const topLlmModelArr = await ModelChatLlmThread.aggregate([
            {
                $match: {
                    userId: res.locals.auth_userId,
                }
            },
            {
                $group: {
                    _id: {
                        aiModelProvider: '$aiModelProvider',
                        aiModelName: '$aiModelName'
                    },
                    count: { $sum: 1 }
                }
            },
            {
                $sort: {
                    count: -1
                }
            },
            {
                $limit: 10
            },
            {
                $project: {
                    aiModelProvider: '$_id.aiModelProvider',
                    aiModelName: '$_id.aiModelName',
                }
            }
        ]) as {
            aiModelProvider: string;
            aiModelName: string;
        }[];

        const uniqueModelArr = [] as {
            aiModelProvider: string;
            aiModelName: string;
        }[];
        for (let index = 0; index < recentlyUsedLlm.length; index++) {
            const element = recentlyUsedLlm[index];
            uniqueModelArr.push(element);
        }

        for (let index = 0; index < topLlmModelArr.length; index++) {
            const element = topLlmModelArr[index];

            let doesExist = false;

            // check does exist
            for (let index = 0; index < uniqueModelArr.length; index++) {
                if (
                    element.aiModelProvider === uniqueModelArr[index].aiModelProvider &&
                    element.aiModelName === uniqueModelArr[index].aiModelName
                ) {
                    doesExist = true;
                }
            }
            if (doesExist) {
                continue;
            }

            uniqueModelArr.push(element);
        }

        return res.json({ message: 'Top LLM conversation model retrieved successfully', modelArr: uniqueModelArr });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Get Last Used LLM Model
router.get('/lastUsedLlmModel', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const lastUsedModel = await ModelChatLlmThread.aggregate([
            {
                $match: {
                    userId: res.locals.auth_userId,
                }
            },
            {
                $sort: {
                    updatedAtUtc: -1
                }
            },
            {
                $limit: 1
            },
            {
                $project: {
                    aiModelProvider: 1,
                    aiModelName: 1,
                    aiModelOpenAiCompatibleConfigId: 1,
                }
            }
        ]) as {
            aiModelProvider: string;
            aiModelName: string;
            aiModelOpenAiCompatibleConfigId?: string;
        }[];

        if (lastUsedModel.length > 0) {
            return res.json({
                message: 'Last used LLM model retrieved successfully',
                model: lastUsedModel[0]
            });
        } else {
            return res.json({
                message: 'No previous model usage found',
                model: null
            });
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;