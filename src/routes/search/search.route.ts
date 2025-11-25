import mongoose, { PipelineStage, FilterQuery } from 'mongoose';
import { Router, Request, Response } from 'express';
import { NodeHtmlMarkdown } from "node-html-markdown";

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { getMongodbObjectOrNull } from '../../utils/common/getMongodbObjectOrNull';
import { generateNgrams, reindexAll } from '../../utils/search/reindexGlobalSearch';
import { ModelRecordEmptyTable } from '../../schema/schemaOther/NoRecordTable';

// Router
const router = Router();

const getUnionPipeline = ({
    username,
    collectionName,
    filterTaskIsCompleted,
    filterTaskIsArchived,
    filterTaskWorkspaceIds,
    filterNotesWorkspaceIds,
    filterLifeEventSearchDiary,
}: {
    username: string;
    collectionName: 'tasks' | 'notes' | 'lifeEvents' | 'infoVault' | 'chatLlmThread';
    filterTaskIsCompleted: 'all' | 'completed' | 'not-completed';
    filterTaskIsArchived: 'all' | 'archived' | 'not-archived';
    filterTaskWorkspaceIds: string[];
    filterNotesWorkspaceIds: string[];
    filterLifeEventSearchDiary: boolean;
}) => {
    if (collectionName === 'tasks') {
        let tempStage = {
            username: username,
            collectionName: collectionName,
        } as {
            username: string;
            collectionName: string;
            taskIsCompleted?: boolean;
            taskIsArchived?: boolean;
            taskWorkspaceId?: {
                $in: mongoose.Types.ObjectId[];
            }
        };
        if (filterTaskIsCompleted === 'completed') {
            tempStage.taskIsCompleted = true;
        } else if (filterTaskIsCompleted === 'not-completed') {
            tempStage.taskIsCompleted = false;
        }
        if (filterTaskIsArchived === 'archived') {
            tempStage.taskIsArchived = true;
        } else if (filterTaskIsArchived === 'not-archived') {
            tempStage.taskIsArchived = false;
        }
        if (filterTaskWorkspaceIds.length > 0) {
            let tempTaskWorkspaceIds = [];
            for (let i = 0; i < filterTaskWorkspaceIds.length; i++) {
                const elementStr = filterTaskWorkspaceIds[i];
                let tempWorkspaceId = getMongodbObjectOrNull(elementStr);
                if (tempWorkspaceId !== null) {
                    tempTaskWorkspaceIds.push(tempWorkspaceId as mongoose.Types.ObjectId);
                }
            }
            if (tempTaskWorkspaceIds.length > 0) {
                tempStage.taskWorkspaceId = { $in: tempTaskWorkspaceIds };
            }
        }

        return {
            $unionWith: {
                coll: 'globalSearch',
                pipeline: [
                    {
                        $match: {
                            ...tempStage
                        }
                    },
                    {
                        $addFields: {
                            collectionName: collectionName
                        }
                    },
                ],
            }
        }
    }

    if (collectionName === 'notes') {
        let tempStage = {
            username: username,
            collectionName: collectionName,
        } as {
            username: string;
            collectionName: string;
            notesWorkspaceId?: {
                $in: mongoose.Types.ObjectId[];
            }
        };
        if (filterNotesWorkspaceIds.length > 0) {
            let tempNotesWorkspaceIds = [];
            for (let i = 0; i < filterNotesWorkspaceIds.length; i++) {
                const elementStr = filterNotesWorkspaceIds[i];
                let tempWorkspaceId = getMongodbObjectOrNull(elementStr);
                if (tempWorkspaceId !== null) {
                    tempNotesWorkspaceIds.push(tempWorkspaceId as mongoose.Types.ObjectId);
                }
            }
            if (tempNotesWorkspaceIds.length > 0) {
                tempStage.notesWorkspaceId = { $in: tempNotesWorkspaceIds };
            }
        }

        return {
            $unionWith: {
                coll: 'globalSearch',
                pipeline: [
                    {
                        $match: {
                            ...tempStage
                        }
                    },
                    {
                        $addFields: {
                            collectionName: collectionName
                        }
                    },
                ],
            }
        }
    }

    if (collectionName === 'lifeEvents') {
        let tempStage = {
            username: username,
            collectionName: collectionName,
        } as {
            username: string;
            collectionName: string;
            lifeEventIsDiary?: boolean;
        };
        if (filterLifeEventSearchDiary === true) {
            // true and false
        } else if (filterLifeEventSearchDiary === false) {
            tempStage.lifeEventIsDiary = false;
        }

        return {
            $unionWith: {
                coll: 'globalSearch',
                pipeline: [
                    {
                        $match: {
                            ...tempStage
                        }
                    },
                    {
                        $addFields: {
                            collectionName: collectionName
                        }
                    },
                ],
            }
        }
    }

    if (collectionName === 'infoVault') {
        let tempStage = {
            username: username,
            collectionName: collectionName,
        } as {
            username: string;
            collectionName: string;
        };
        return {
            $unionWith: {
                coll: 'globalSearch',
                pipeline: [
                    {
                        $match: {
                            ...tempStage
                        }
                    },
                    {
                        $addFields: {
                            collectionName: collectionName
                        }
                    },
                ],
            }
        }
    }

    if (collectionName === 'chatLlmThread') {
        let tempStage = {
            username: username,
            collectionName: collectionName,
        } as {
            username: string;
            collectionName: string;
        };
        return {
            $unionWith: {
                coll: 'globalSearch',
                pipeline: [
                    {
                        $match: {
                            ...tempStage
                        }
                    },
                    {
                        $addFields: {
                            collectionName: collectionName
                        }
                    },
                ],
            }
        }
    }

    return null;
}

// Get Search Result API
router.post(
    '/search',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            // args
            let page = 1;
            let perPage = 100;

            let filterEventTypeTasks = true;
            let filterEventTypeLifeEvents = true;
            let filterEventTypeNotes = true;
            let filterEventTypeInfoVault = true;
            let filterEventTypeChatLlm = true;
            let filterLifeEventSearchDiary = true;

            // filter -> task
            let filterTaskIsCompleted: 'all' | 'completed' | 'not-completed' = 'all';
            let filterTaskIsArchived: 'all' | 'archived' | 'not-archived' = 'all';
            let filterTaskWorkspaceIds: string[] = [];

            // filter -> note
            let filterNotesWorkspaceIds: string[] = [];

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

            // set arg -> filterEventTypeTasks
            if (typeof req.body?.filterEventTypeTasks === 'boolean') {
                filterEventTypeTasks = req.body.filterEventTypeTasks;
            }
            // set arg -> filterEventTypeLifeEvents
            if (typeof req.body?.filterEventTypeLifeEvents === 'boolean') {
                filterEventTypeLifeEvents = req.body.filterEventTypeLifeEvents;
            }
            // set arg -> filterEventTypeNotes
            if (typeof req.body?.filterEventTypeNotes === 'boolean') {
                filterEventTypeNotes = req.body.filterEventTypeNotes;
            }
            // set arg -> filterEventTypeInfoVault
            if (typeof req.body?.filterEventTypeInfoVault === 'boolean') {
                filterEventTypeInfoVault = req.body.filterEventTypeInfoVault;
            }
            // set arg -> filterLifeEventSearchDiary
            if (typeof req.body?.filterLifeEventSearchDiary === 'boolean') {
                filterLifeEventSearchDiary = req.body.filterLifeEventSearchDiary;
            }
            // set arg -> filterEventTypeChatLlm
            if (typeof req.body?.filterEventTypeChatLlm === 'boolean') {
                filterEventTypeChatLlm = req.body.filterEventTypeChatLlm;
            }

            // set arg -> filterTaskIsCompleted
            if (typeof req.body?.filterTaskIsCompleted === 'string') {
                if (req.body.filterTaskIsCompleted === 'all' || req.body.filterTaskIsCompleted === 'completed' || req.body.filterTaskIsCompleted === 'not-completed') {
                    filterTaskIsCompleted = req.body.filterTaskIsCompleted;
                }
            }
            // set arg -> filterTaskIsArchived
            if (typeof req.body?.filterTaskIsArchived === 'string') {
                if (req.body.filterTaskIsArchived === 'all' || req.body.filterTaskIsArchived === 'archived' || req.body.filterTaskIsArchived === 'not-archived') {
                    filterTaskIsArchived = req.body.filterTaskIsArchived;
                }
            }
            // set arg -> filterTaskWorkspaceIds
            if (Array.isArray(req.body?.filterTaskWorkspaceIds)) {
                filterTaskWorkspaceIds = req.body.filterTaskWorkspaceIds;
            }

            // set arg -> filterNotesWorkspaceIds
            if (Array.isArray(req.body?.filterNotesWorkspaceIds)) {
                filterNotesWorkspaceIds = req.body.filterNotesWorkspaceIds;
            }

            // Process search query
            let searchQuery = '';
            if (typeof req.body?.search === 'string' && req.body.search.length >= 1) {
                searchQuery = req.body.search as string;
            }

            // Build aggregation pipeline
            let tempStage = {} as PipelineStage;
            const pipelineDocument: PipelineStage[] = [];
            const pipelineCount: PipelineStage[] = [];

            // union pipeline -> task
            if (filterEventTypeTasks) {
                const unionPipeline = getUnionPipeline({
                    username: res.locals.auth_username,
                    collectionName: 'tasks',
                    filterTaskIsCompleted,
                    filterTaskIsArchived,
                    filterTaskWorkspaceIds,
                    filterNotesWorkspaceIds,
                    filterLifeEventSearchDiary,
                });
                if (unionPipeline !== null) {
                    pipelineDocument.push(unionPipeline);
                    pipelineCount.push(unionPipeline);
                }
            }

            // union pipeline -> note
            if (filterEventTypeNotes) {
                const unionPipeline = getUnionPipeline({
                    username: res.locals.auth_username,
                    collectionName: 'notes',

                    // filter
                    filterTaskIsCompleted,
                    filterTaskIsArchived,
                    filterTaskWorkspaceIds,
                    filterNotesWorkspaceIds,
                    filterLifeEventSearchDiary,
                });
                if (unionPipeline !== null) {
                    pipelineDocument.push(unionPipeline);
                    pipelineCount.push(unionPipeline);
                }
            }

            // union pipeline -> lifeEvent
            if (filterEventTypeLifeEvents) {
                const unionPipeline = getUnionPipeline({
                    username: res.locals.auth_username,
                    collectionName: 'lifeEvents',

                    // filter
                    filterTaskIsCompleted,
                    filterTaskIsArchived,
                    filterTaskWorkspaceIds,
                    filterNotesWorkspaceIds,
                    filterLifeEventSearchDiary,
                });
                if (unionPipeline !== null) {
                    pipelineDocument.push(unionPipeline);
                    pipelineCount.push(unionPipeline);
                }
            }

            // union pipeline -> infoVault
            if (filterEventTypeInfoVault) {
                const unionPipeline = getUnionPipeline({
                    username: res.locals.auth_username,
                    collectionName: 'infoVault',

                    // filter
                    filterTaskIsCompleted,
                    filterTaskIsArchived,
                    filterTaskWorkspaceIds,
                    filterNotesWorkspaceIds,
                    filterLifeEventSearchDiary,
                });
                if (unionPipeline !== null) {
                    pipelineDocument.push(unionPipeline);
                    pipelineCount.push(unionPipeline);
                }
            }

            // union pipeline -> chatLlmThread
            if (filterEventTypeChatLlm) {
                const unionPipeline = getUnionPipeline({
                    username: res.locals.auth_username,
                    collectionName: 'chatLlmThread',

                    // filter
                    filterTaskIsCompleted,
                    filterTaskIsArchived,
                    filterTaskWorkspaceIds,
                    filterNotesWorkspaceIds,
                    filterLifeEventSearchDiary,
                });
                if (unionPipeline !== null) {
                    pipelineDocument.push(unionPipeline);
                    pipelineCount.push(unionPipeline);
                }
            }

            // Build search query conditions
            let matchConditionsSearch = {
                username: res.locals.auth_username,
            } as {
                username: string;
                $and?: { text: { $regex: string; $options: string } }[] | undefined;
            };
            if (searchQuery && searchQuery.length >= 1) {
                const searchQueryLower = searchQuery
                    .toLowerCase()
                    .trim()
                    .replace('-', ' ')
                    .split(' ')
                    .map(item => item.trim())
                    .filter(item => item.length >= 1);
                const searchQueryAndConditions = searchQueryLower.map(item => {
                    return { text: { $regex: item, $options: 'i' } };
                });
                if (searchQueryAndConditions.length > 0) {
                    matchConditionsSearch.$and = searchQueryAndConditions;
                    pipelineDocument.push({
                        $match: matchConditionsSearch
                    });
                    pipelineCount.push({
                        $match: matchConditionsSearch
                    });
                }
            }

            // Sort stage
            tempStage = {
                $sort: { updatedAtUtc: -1 }
            };
            pipelineDocument.push(tempStage);
            pipelineCount.push(tempStage);

            // Pagination
            tempStage = {
                $skip: (page - 1) * perPage
            };
            pipelineDocument.push(tempStage);
            tempStage = {
                $limit: perPage
            };
            pipelineDocument.push(tempStage);

            // Lookup based on entity type
            tempStage = {
                $lookup: {
                    from: 'tasks',
                    localField: 'entityId',
                    foreignField: '_id',
                    as: 'taskDoc'
                }
            };
            pipelineDocument.push(tempStage);

            tempStage = {
                $lookup: {
                    from: 'notes',
                    localField: 'entityId',
                    foreignField: '_id',
                    as: 'noteDoc'
                }
            };
            pipelineDocument.push(tempStage);

            tempStage = {
                $lookup: {
                    from: 'lifeEvents',
                    localField: 'entityId',
                    foreignField: '_id',
                    as: 'lifeEventDoc'
                }
            };
            pipelineDocument.push(tempStage);

            tempStage = {
                $lookup: {
                    from: 'infoVault',
                    localField: 'entityId',
                    foreignField: '_id',
                    as: 'infoVaultDoc'
                }
            };
            pipelineDocument.push(tempStage);

            tempStage = {
                $lookup: {
                    from: 'chatLlmThread',
                    localField: 'entityId',
                    foreignField: '_id',
                    as: 'chatLlmThreadDoc'
                }
            };
            pipelineDocument.push(tempStage);

            // Filter out documents where lookup didn't find a match
            tempStage = {
                $match: {
                    _id: { $ne: null }
                }
            };
            pipelineDocument.push(tempStage);
            pipelineCount.push(tempStage);

            // Project to create unified structure
            tempStage = {
                $project: {
                    _id: {
                        $cond: [
                            { $eq: ['$entityType', 'task'] },
                            { $arrayElemAt: ['$taskDoc._id', 0] },
                            {
                                $cond: [
                                    { $eq: ['$entityType', 'note'] },
                                    { $arrayElemAt: ['$noteDoc._id', 0] },
                                    {
                                        $cond: [
                                            { $eq: ['$entityType', 'lifeEvent'] },
                                            { $arrayElemAt: ['$lifeEventDoc._id', 0] },
                                            {
                                                $cond: [
                                                    { $eq: ['$entityType', 'infoVault'] },
                                                    { $arrayElemAt: ['$infoVaultDoc._id', 0] },
                                                    { $arrayElemAt: ['$chatLlmThreadDoc._id', 0] }
                                                ]
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    },
                    updatedAtUtcSort: {
                        $cond: [
                            { $eq: ['$entityType', 'task'] },
                            { $arrayElemAt: ['$taskDoc.updatedAtUtc', 0] },
                            {
                                $cond: [
                                    { $eq: ['$entityType', 'note'] },
                                    { $arrayElemAt: ['$noteDoc.updatedAtUtc', 0] },
                                    {
                                        $cond: [
                                            { $eq: ['$entityType', 'lifeEvent'] },
                                            { $arrayElemAt: ['$lifeEventDoc.updatedAtUtc', 0] },
                                            {
                                                $cond: [
                                                    { $eq: ['$entityType', 'infoVault'] },
                                                    { $arrayElemAt: ['$infoVaultDoc.updatedAtUtc', 0] },
                                                    { $arrayElemAt: ['$chatLlmThreadDoc.updatedAtUtc', 0] }
                                                ]
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    },
                    taskDoc: 1,
                    noteDoc: 1,
                    lifeEventDoc: 1,
                    infoVaultDoc: 1,
                    chatLlmThreadDoc: 1,
                    collectionName: 1,
                }
            };
            pipelineDocument.push(tempStage);

            // Count pipeline
            tempStage = {
                $count: 'count'
            };
            pipelineCount.push(tempStage);

            // Execute aggregation
            const resultDocs = await ModelRecordEmptyTable.aggregate(pipelineDocument);
            const countResult = await ModelRecordEmptyTable.aggregate(pipelineCount);
            const totalCount = countResult.length > 0 ? (countResult[0]?.count || 0) : 0;

            // Process results and extract first element from arrays
            const resultDocsFiltered = resultDocs.map((doc) => {
                return {
                    ...doc,
                    taskInfo: doc.taskDoc && doc.taskDoc.length > 0 ? doc.taskDoc[0] : undefined,
                    notesInfo: doc.noteDoc && doc.noteDoc.length > 0 ? doc.noteDoc[0] : undefined,
                    lifeEventInfo: doc.lifeEventDoc && doc.lifeEventDoc.length > 0 ? doc.lifeEventDoc[0] : undefined,
                    infoVaultInfo: doc.infoVaultDoc && doc.infoVaultDoc.length > 0 ? doc.infoVaultDoc[0] : undefined,
                    chatLlmThreadInfo: doc.chatLlmThreadDoc && doc.chatLlmThreadDoc.length > 0 ? doc.chatLlmThreadDoc[0] : undefined,
                };
            });

            // Process notes description to markdown
            const resultDocsFinal = resultDocsFiltered.map((doc) => {
                if (doc.collectionName === 'notes') {
                    if (doc?.notesInfo && doc?.notesInfo?.description && doc?.notesInfo?.description.length >= 1) {
                        const markdownContent = NodeHtmlMarkdown.translate(doc?.notesInfo?.description);
                        return {
                            ...doc,
                            notesInfo: {
                                ...doc?.notesInfo,
                                descriptionMarkdown: markdownContent,
                            }
                        };
                    }
                }
                return doc;
            });

            return res.json({
                message: 'Search result retrieved successfully',
                count: totalCount,
                docs: resultDocsFinal,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Reindex All API
router.post(
    '/reindex-all',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const username = res.locals.auth_username;

            // Start reindexing
            await reindexAll({ username })

            return res.json({
                message: 'Reindexing started. This may take a few minutes.',
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

export default router;