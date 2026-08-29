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
import cleanupThreadOnDelete from './utils/cleanupThreadOnDelete';
import type { tsUserApiKey } from '../../../utils/llm/llmCommonFunc';
import { contextWindowLimitsFromDoc } from '../chatLlmCrud/agent/agentUtils/agentContextWindow';
import { normalizeAgentScriptMaxTokens } from '../chatLlmCrud/agent/agentUtils/agentScriptMaxTokens';
import { ModelAgentInstance } from '../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentInstance.schema';
import { ModelAgentOpencodeInstance } from '../../../schema/schemaChatLlm/SchemaAgentOpencode/SchemaAgentOpencodeInstance.schema';

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
            } as any
        }
        if (typeof req.body?.isFavourite === 'string') {
            if (req.body.isFavourite === 'true' || req.body.isFavourite === 'false') {
                tempStage.$match.isFavourite = req.body.isFavourite === 'true' ? true : false;
            }
        }
        if (typeof req.body?.answerEngine === 'string' && req.body.answerEngine.trim()) {
            tempStage.$match.answerEngine = req.body.answerEngine.trim();
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
        let sortStage: Record<string, 1 | -1> = { createdAtUtc: -1 };
        if (req.body?.sort === 'oldest') {
            sortStage = { createdAtUtc: 1 };
        } else if (req.body?.sort === 'title') {
            sortStage = { threadTitle: 1 };
        }

        tempStage = {
            $sort: sortStage
        };
        stateDocument.push(tempStage);

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

        const threadIds = resultThreads.map((t: Record<string, unknown>) => t._id).filter(Boolean) as mongoose.Types.ObjectId[];
        let tokenMap = new Map<string, { totalTokens: number; totalCost: number; count: number }>();
        let pendingSet = new Set<string>();
        if (threadIds.length > 0) {
            try {
                const tokenAgg = await ModelChatLlm.aggregate([
                    { $match: { threadId: { $in: threadIds }, userId: res.locals.auth_userId } },
                    { $group: { _id: '$threadId', totalTokens: { $sum: { $ifNull: ['$totalTokens', 0] } }, totalCost: { $sum: { $ifNull: ['$costInUsd', 0] } }, count: { $sum: 1 } } },
                ]);
                for (const row of tokenAgg as Array<{ _id: mongoose.Types.ObjectId; totalTokens: number; totalCost: number; count: number }>) {
                    tokenMap.set(String(row._id), { totalTokens: row.totalTokens || 0, totalCost: row.totalCost || 0, count: row.count || 0 });
                }
            } catch {
            }
            try {
                const pendingAgg = await ModelAgentInstance.aggregate([
                    { $match: { threadId: { $in: threadIds }, status: 'pending' } },
                    { $group: { _id: '$threadId' } },
                ]);
                for (const row of pendingAgg as Array<{ _id: mongoose.Types.ObjectId }>) {
                    pendingSet.add(String(row._id));
                }
            } catch {
            }
            try {
                const pendingOpencode = await ModelAgentOpencodeInstance.aggregate([
                    { $match: { threadId: { $in: threadIds }, status: 'pending' } },
                    { $group: { _id: '$threadId' } },
                ]);
                for (const row of pendingOpencode as Array<{ _id: mongoose.Types.ObjectId }>) {
                    pendingSet.add(String(row._id));
                }
            } catch {
            }
        }

        const enriched = resultThreads.map((t: Record<string, unknown>) => {
            const idStr = String(t._id);
            const tok = tokenMap.get(idStr);
            return {
                ...t,
                messageCount: tok ? tok.count : 0,
                totalTokens: tok ? tok.totalTokens : (typeof t.cachedTotalTokens === 'number' ? t.cachedTotalTokens : 0),
                totalCostUsd: tok ? tok.totalCost : (typeof t.cachedTotalCostUsd === 'number' ? t.cachedTotalCostUsd : 0),
                isPending: pendingSet.has(idStr),
            };
        });

        return res.json({
            message: 'Chat LLM Threads retrieved successfully',
            docs: enriched,
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

        // delete agent records + chat-shell runs + shell workspace folders
        try {
            await cleanupThreadOnDelete({
                threadId,
                userId: res.locals.auth_userId,
                apiKey: res.locals.apiKey as tsUserApiKey,
            });
        } catch (cleanupErr) {
            console.error('[threadsDeleteById] agent/shell cleanup failed:', cleanupErr);
        }

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
                agentContextActionLimit,
                agentContextSummaryCount,
                agentContextMessagesPerSummary,
                agentScriptMaxTokens,

                executeShell,
                shellExecuteMinAttempts,
                shellExecuteMaxAttempts,

                useOmniparser,

                opencodeMcpEnabled,
                opencodeMaxAnswerTimeMinutes,
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
                answerEngine: 'conciseAnswer' as 'conciseAnswer' | 'agent' | 'agentOpencode',

                // agent budgets
                agentMinBudgetTokens: 1,
                agentMaxBudgetTokens: 1_000_000,
                agentMinNumberOfIterations: 1,
                agentMaxNumberOfIterations: 100,
                agentContextActionLimit: 100,
                agentContextSummaryCount: 10,
                agentContextMessagesPerSummary: 10,
                agentScriptMaxTokens: 8192,

                executeShell: false,
                shellExecuteMinAttempts: 1,
                shellExecuteMaxAttempts: 1,

                useOmniparser: false,

                opencodeMcpEnabled: true,
                opencodeMaxAnswerTimeMinutes: 60,
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
                if (
                    answerEngine === 'conciseAnswer' ||
                    answerEngine === 'agent' ||
                    answerEngine === 'agentOpencode'
                ) {
                    addData.answerEngine = answerEngine;
                }
            };

            if (typeof executeShell === 'boolean') {
                addData.executeShell = executeShell;
            };

            if (typeof useOmniparser === 'boolean') {
                addData.useOmniparser = useOmniparser;
            };

            if (typeof opencodeMcpEnabled === 'boolean') {
                addData.opencodeMcpEnabled = opencodeMcpEnabled;
            }

            if (typeof opencodeMaxAnswerTimeMinutes === 'number') {
                addData.opencodeMaxAnswerTimeMinutes = Math.max(1, Math.round(opencodeMaxAnswerTimeMinutes));
            }
            
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

            const contextWindow = contextWindowLimitsFromDoc({
                agentContextActionLimit,
                agentContextSummaryCount,
                agentContextMessagesPerSummary,
            });
            if (typeof agentContextActionLimit === 'number') {
                addData.agentContextActionLimit = contextWindow.actionLimit;
            }
            if (typeof agentContextSummaryCount === 'number') {
                addData.agentContextSummaryCount = contextWindow.summaryCount;
            }
            if (typeof agentContextMessagesPerSummary === 'number') {
                addData.agentContextMessagesPerSummary = contextWindow.messagesPerSummary;
            }
            if (typeof agentScriptMaxTokens === 'number') {
                addData.agentScriptMaxTokens = normalizeAgentScriptMaxTokens(agentScriptMaxTokens);
            }

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
                agentContextActionLimit,
                agentContextSummaryCount,
                agentContextMessagesPerSummary,
                agentScriptMaxTokens,

                executeShell,

                shellExecuteMinAttempts,
                shellExecuteMaxAttempts,

                useOmniparser,

                opencodeMcpEnabled,
                opencodeMaxAnswerTimeMinutes,
            } = req.body;

            // Build update object
            const updateData: any = {};
            if (typeof threadTitle === 'string') {
                updateData.threadTitle = threadTitle.trim().slice(0, 200)
            };
            if (typeof (req.body as Record<string, unknown>).isArchived === 'boolean') {
                updateData.isArchived = (req.body as Record<string, unknown>).isArchived as boolean;
            }

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
                if (
                    answerEngine === 'conciseAnswer' ||
                    answerEngine === 'agent' ||
                    answerEngine === 'agentOpencode'
                ) {
                    updateData.answerEngine = answerEngine;
                }
            };

            if (typeof executeShell === 'boolean') {
                updateData.executeShell = executeShell;
            };

            if (typeof useOmniparser === 'boolean') {
                updateData.useOmniparser = useOmniparser;
            };

            if (typeof opencodeMcpEnabled === 'boolean') {
                updateData.opencodeMcpEnabled = opencodeMcpEnabled;
            }

            if (typeof opencodeMaxAnswerTimeMinutes === 'number') {
                updateData.opencodeMaxAnswerTimeMinutes = Math.max(1, Math.round(opencodeMaxAnswerTimeMinutes));
            }
            
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

            const contextWindowEdit = contextWindowLimitsFromDoc({
                agentContextActionLimit,
                agentContextSummaryCount,
                agentContextMessagesPerSummary,
            });
            if (typeof agentContextActionLimit === 'number') {
                updateData.agentContextActionLimit = contextWindowEdit.actionLimit;
            }
            if (typeof agentContextSummaryCount === 'number') {
                updateData.agentContextSummaryCount = contextWindowEdit.summaryCount;
            }
            if (typeof agentContextMessagesPerSummary === 'number') {
                updateData.agentContextMessagesPerSummary = contextWindowEdit.messagesPerSummary;
            }
            if (typeof agentScriptMaxTokens === 'number') {
                updateData.agentScriptMaxTokens = normalizeAgentScriptMaxTokens(agentScriptMaxTokens);
            }

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

router.post('/threadsBulkAction', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const ids = Array.isArray(req.body?.threadIds) ? req.body.threadIds : [];
        const action = typeof req.body?.action === 'string' ? req.body.action : '';
        if (ids.length === 0) {
            return res.status(400).json({ message: 'No threadIds provided' });
        }
        if (ids.length > 100) {
            return res.status(400).json({ message: 'Too many threadIds' });
        }
        const objectIds: mongoose.Types.ObjectId[] = [];
        for (const raw of ids) {
            if (typeof raw === 'string' && raw.length === 24) {
                try {
                    objectIds.push(mongoose.Types.ObjectId.createFromHexString(raw));
                } catch {
                }
            }
        }
        if (objectIds.length === 0) {
            return res.status(400).json({ message: 'Invalid threadIds' });
        }
        if (action === 'delete') {
            await ModelChatLlm.deleteMany({ userId: res.locals.auth_userId, threadId: { $in: objectIds } });
            await ModelChatLlmThreadContextReference.deleteMany({ userId: res.locals.auth_userId, threadId: { $in: objectIds } });
            const del = await ModelChatLlmThread.deleteMany({ _id: { $in: objectIds }, userId: res.locals.auth_userId });
            return res.json({ message: 'Bulk delete done', deletedCount: del.deletedCount });
        }
        if (action === 'archive') {
            const upd = await ModelChatLlmThread.updateMany({ _id: { $in: objectIds }, userId: res.locals.auth_userId }, { $set: { isArchived: true } });
            return res.json({ message: 'Bulk archive done', modifiedCount: upd.modifiedCount });
        }
        if (action === 'unarchive') {
            const upd = await ModelChatLlmThread.updateMany({ _id: { $in: objectIds }, userId: res.locals.auth_userId }, { $set: { isArchived: false } });
            return res.json({ message: 'Bulk unarchive done', modifiedCount: upd.modifiedCount });
        }
        return res.status(400).json({ message: 'Invalid action' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.get('/threadsExport/:threadId', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const rawId = req.params.threadId;
        if (typeof rawId !== 'string' || rawId.length !== 24) {
            return res.status(400).json({ message: 'Invalid threadId' });
        }
        const threadId = mongoose.Types.ObjectId.createFromHexString(rawId);
        const thread = await ModelChatLlmThread.findOne({ _id: threadId, userId: res.locals.auth_userId });
        if (!thread) {
            return res.status(404).json({ message: 'Thread not found' });
        }
        const messages = await ModelChatLlm.find({ threadId, userId: res.locals.auth_userId }).sort({ createdAtUtc: 1 }).lean();
        const lines: string[] = [];
        lines.push(`# ${thread.threadTitle || 'Untitled Thread'}`);
        lines.push('');
        lines.push(`- Thread ID: ${String(thread._id)}`);
        lines.push(`- Created: ${thread.createdAtUtc ? new Date(thread.createdAtUtc).toISOString() : ''}`);
        lines.push(`- Model: ${thread.aiModelProvider || ''} ${thread.aiModelName || ''}`);
        lines.push('');
        lines.push('---');
        lines.push('');
        for (const m of messages) {
            const who = (m as Record<string, unknown>).isAi ? 'Assistant' : 'User';
            const modelInfo = (m as Record<string, unknown>).aiModelName ? ` (${(m as Record<string, unknown>).aiModelProvider}/${(m as Record<string, unknown>).aiModelName})` : '';
            const when = (m as Record<string, unknown>).createdAtUtc ? new Date((m as Record<string, unknown>).createdAtUtc as string).toISOString() : '';
            lines.push(`## ${who}${modelInfo} — ${when}`);
            lines.push('');
            const content = String((m as Record<string, unknown>).content || '');
            lines.push(content);
            const tok = (m as Record<string, unknown>).totalTokens as number | undefined;
            const cost = (m as Record<string, unknown>).costInUsd as number | undefined;
            if (typeof tok === 'number' && tok > 0) {
                lines.push('');
                lines.push(`*Tokens: ${tok} Cost: $${typeof cost === 'number' ? cost.toFixed(6) : '0'}*`);
            }
            lines.push('');
            lines.push('---');
            lines.push('');
        }
        const md = lines.join('\n');
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="thread-${rawId}.md"`);
        return res.send(md);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

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