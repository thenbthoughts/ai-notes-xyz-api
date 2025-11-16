import mongoose, { PipelineStage, FilterQuery } from 'mongoose';
import { Router, Request, Response } from 'express';
import { NodeHtmlMarkdown } from "node-html-markdown";

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { getMongodbObjectOrNull } from '../../utils/common/getMongodbObjectOrNull';
import { ModelGlobalSearch } from '../../schema/schemaGlobalSearch/SchemaGlobalSearch.schema';
import { generateNgrams, reindexAll } from '../../utils/search/reindexGlobalSearch';
import { ModelRecordEmptyTable } from '../../schema/schemaOther/NoRecordTable';

// Router
const router = Router();

const getUnionPipeline = ({
    username,
    fromCollection,
    filterTaskIsCompleted,
    filterTaskIsArchived,
    filterTaskWorkspaceIds,
    filterNotesWorkspaceIds,
    filterLifeEventSearchDiary,
}: {
    username: string;
    fromCollection: 'task' | 'note' | 'lifeEvent' | 'infoVault' | 'chatLlmThread';
    filterTaskIsCompleted: 'all' | 'completed' | 'not-completed';
    filterTaskIsArchived: 'all' | 'archived' | 'not-archived';
    filterTaskWorkspaceIds: string[];
    filterNotesWorkspaceIds: string[];
    filterLifeEventSearchDiary: boolean;
}) => {
    // Build match conditions for globalSearch
    const matchConditions: FilterQuery<{
        username: string;
        entityType: string;
        ngram: string[];
        text: string;
        $or: [],
    }> = {
        username: username,
    };

    if (fromCollection === 'task') {
        let tempStage = {
            username: username,
        } as {
            username: string;
            taskIsCompleted?: boolean;
            taskIsArchived?: boolean;
            taskWorkspaceId?: mongoose.Types.ObjectId[];
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
                tempStage.taskWorkspaceId = tempTaskWorkspaceIds;
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
                    }
                ],
            }
        }
    }

    if (fromCollection === 'note') {
        let tempStage = {
            username: username,
        } as {
            username: string;
            notesWorkspaceId?: mongoose.Types.ObjectId[];
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
                tempStage.notesWorkspaceId = tempNotesWorkspaceIds;
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
                    }
                ],
            }
        }
    }

    if (fromCollection === 'lifeEvent') {
        let tempStage = {
            username: username,
        } as {
            username: string;
            lifeEventIsDiary?: boolean;
        };
        if (filterLifeEventSearchDiary === true) {
            tempStage.lifeEventIsDiary = true;
        }

        return {
            $unionWith: {
                coll: 'globalSearch',
                pipeline: [
                    {
                        $match: {
                            ...tempStage
                        }
                    }
                ],
            }
        }
    }

    if (fromCollection === 'infoVault') {
        let tempStage = {
            username: username,
        } as {
            username: string;
        };
        return {
            $unionWith: {
                coll: 'globalSearch',
                pipeline: [
                    {
                        $match: {
                            ...tempStage
                        }
                    }
                ],
            }
        }
    }

    if (fromCollection === 'chatLlmThread') {
        let tempStage = {
            username: username,
        } as {
            username: string;
        };
        return {
            $unionWith: {
                coll: 'globalSearch',
                pipeline: [
                    {
                        $match: {
                            ...tempStage
                        }
                    }
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

            // Build match conditions for globalSearch
            const matchConditions: FilterQuery<{
                username: string;
                entityType: string;
                ngram: string[];
                text: string;
                $or: [],
            }> = {
                username: res.locals.auth_username,
            };

            // Filter by entity types
            const entityTypes: string[] = [];
            if (filterEventTypeTasks) entityTypes.push('task');
            if (filterEventTypeNotes) entityTypes.push('note');
            if (filterEventTypeLifeEvents) entityTypes.push('lifeEvent');
            if (filterEventTypeInfoVault) entityTypes.push('infoVault');
            if (filterEventTypeChatLlm) entityTypes.push('chatLlmThread');

            if (entityTypes.length > 0) {
                matchConditions.entityType = { $in: entityTypes };
            }

            // Apply task filters
            const taskFilterConditions: any[] = [];

            if (filterTaskIsCompleted === 'completed') {
                taskFilterConditions.push({ taskIsCompleted: true });
            } else if (filterTaskIsCompleted === 'not-completed') {
                taskFilterConditions.push({ taskIsCompleted: false });
            }

            if (filterTaskIsArchived === 'archived') {
                taskFilterConditions.push({ taskIsArchived: true });
            } else if (filterTaskIsArchived === 'not-archived') {
                taskFilterConditions.push({ taskIsArchived: false });
            }

            if (filterTaskWorkspaceIds.length > 0) {
                const taskWorkspaceIdsObj = filterTaskWorkspaceIds.map(id => getMongodbObjectOrNull(id)).filter(id => id !== null);
                if (taskWorkspaceIdsObj.length > 0) {
                    taskFilterConditions.push({ taskWorkspaceId: { $in: taskWorkspaceIdsObj } });
                }
            }

            if (taskFilterConditions.length > 0) {
                matchConditions.$or = matchConditions.$or || [];
                matchConditions.$or.push({
                    $and: [
                        { entityType: 'task' },
                        ...taskFilterConditions
                    ]
                });
            }

            // Apply notes filters
            const notesFilterConditions: any[] = [];

            if (filterNotesWorkspaceIds.length > 0) {
                const notesWorkspaceIdsObj = filterNotesWorkspaceIds.map(id => getMongodbObjectOrNull(id)).filter(id => id !== null);
                if (notesWorkspaceIdsObj.length > 0) {
                    notesFilterConditions.push({ notesWorkspaceId: { $in: notesWorkspaceIdsObj } });
                }
            }

            if (notesFilterConditions.length > 0) {
                matchConditions.$or = matchConditions.$or || [];
                matchConditions.$or.push({
                    $and: [
                        { entityType: 'note' },
                        ...notesFilterConditions
                    ]
                });
            }

            // Apply life event filters
            const lifeEventFilterConditions: any[] = [];

            if (filterLifeEventSearchDiary === true) {
                lifeEventFilterConditions.push({ lifeEventIsDiary: true });
            }

            if (lifeEventFilterConditions.length > 0) {
                matchConditions.$or = matchConditions.$or || [];
                matchConditions.$or.push({
                    $and: [
                        { entityType: 'lifeEvent' },
                        ...lifeEventFilterConditions
                    ]
                });
            }

            // Build search query conditions
            if (searchQuery && searchQuery.length >= 1) {
                const searchQueryLower = searchQuery.toLowerCase();
                const searchNgrams = generateNgrams({ text: searchQueryLower });

                // Use ngram matching for partial text search
                if (searchNgrams.length > 0) {
                    matchConditions.ngram = { $in: searchNgrams };
                } else {
                    // Fallback to text search if ngrams can't be generated
                    matchConditions.text = { $regex: searchQueryLower, $options: 'i' };
                }
            }

            const finalMatch: FilterQuery<any> = { ...matchConditions };

            // Build aggregation pipeline
            let tempStage = {} as PipelineStage;
            const pipelineDocument: PipelineStage[] = [];
            const pipelineCount: PipelineStage[] = [];

            // union pipeline -> task
            if (filterEventTypeTasks) {
                const unionPipeline = getUnionPipeline({
                    username: res.locals.auth_username,
                    fromCollection: 'task',
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
                    fromCollection: 'note',

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
                    fromCollection: 'lifeEvent',

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
                    fromCollection: 'infoVault',
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
                    fromCollection: 'chatLlmThread',
                });
                if (unionPipeline !== null) {
                    pipelineDocument.push(unionPipeline);
                    pipelineCount.push(unionPipeline);
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
                    from: 'lifeEvents',
                    localField: 'entityId',
                    foreignField: '_id',
                    as: 'lifeEventDoc'
                }
            };
            pipelineDocument.push(tempStage);

            tempStage = {
                $lookup: {
                    from: 'infoVaultSignificantDate',
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

            // Lookup infoVault parent for infoVaultSignificantDate
            tempStage = {
                $lookup: {
                    from: 'infoVault',
                    localField: 'infoVaultDoc.infoVaultId',
                    foreignField: '_id',
                    as: 'infoVaultParentDoc'
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
                    fromCollection: {
                        $cond: [
                            { $eq: ['$entityType', 'task'] },
                            'tasks',
                            {
                                $cond: [
                                    { $eq: ['$entityType', 'note'] },
                                    'notes',
                                    {
                                        $cond: [
                                            { $eq: ['$entityType', 'lifeEvent'] },
                                            'lifeEvents',
                                            {
                                                $cond: [
                                                    { $eq: ['$entityType', 'infoVault'] },
                                                    'infoVaultSignificantDate',
                                                    'chatLlmThread'
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
                    infoVaultParentDoc: 1,
                    chatLlmThreadDoc: 1
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

            console.log('resultDocs', JSON.stringify(pipelineDocument));
            console.log('countResult', JSON.stringify(pipelineCount));
            console.log('totalCount', totalCount);

            // Process results and extract first element from arrays
            const resultDocsFiltered = resultDocs.map((doc) => {
                return {
                    ...doc,
                    taskInfo: doc.taskDoc && doc.taskDoc.length > 0 ? doc.taskDoc[0] : undefined,
                    notesInfo: doc.noteDoc && doc.noteDoc.length > 0 ? doc.noteDoc[0] : undefined,
                    lifeEventInfo: doc.lifeEventDoc && doc.lifeEventDoc.length > 0 ? doc.lifeEventDoc[0] : undefined,
                    infoVaultSignificantDate: doc.infoVaultDoc && doc.infoVaultDoc.length > 0 ? doc.infoVaultDoc[0] : undefined,
                    infoVaultInfo: doc.infoVaultParentDoc && doc.infoVaultParentDoc.length > 0 ? doc.infoVaultParentDoc[0] : undefined,
                    chatLlmThreadInfo: doc.chatLlmThreadDoc && doc.chatLlmThreadDoc.length > 0 ? doc.chatLlmThreadDoc[0] : undefined,
                };
            });

            // Process notes description to markdown
            const resultDocsFinal = resultDocsFiltered.map((doc) => {
                if (doc.fromCollection === 'notes') {
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