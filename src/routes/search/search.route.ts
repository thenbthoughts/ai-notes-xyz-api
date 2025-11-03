import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';
import { NodeHtmlMarkdown } from "node-html-markdown";

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelRecordEmptyTable } from '../../schema/schemaOther/NoRecordTable';
import { getMongodbObjectOrNull } from '../../utils/common/getMongodbObjectOrNull';

// Router
const router = Router();

const getSearchResultFromTasks = ({
    username,
    searchQuery,

    // filter -> task
    filterTaskIsCompleted,
    filterTaskIsArchived,
    filterTaskWorkspaceIds,
}: {
    username: string;
    searchQuery: string;

    // filter -> task
    filterTaskIsCompleted: 'all' | 'completed' | 'not-completed';
    filterTaskIsArchived: 'all' | 'archived' | 'not-archived';
    filterTaskWorkspaceIds: string[];
}) => {
    type PipelineStageCustom = PipelineStage.Match | PipelineStage.AddFields | PipelineStage.Lookup | PipelineStage.Project | PipelineStage.Unset;

    let tempStage = {} as PipelineStageCustom;
    const stateDocument = [] as PipelineStageCustom[];

    // stateDocument -> match
    const matchConditions: any = {
        username: username,
    };
    if (filterTaskIsCompleted === 'completed') {
        matchConditions.isCompleted = true;
    } else if (filterTaskIsCompleted === 'not-completed') {
        matchConditions.isCompleted = false;
    }
    if (filterTaskIsArchived === 'archived') {
        matchConditions.isArchived = true;
    } else if (filterTaskIsArchived === 'not-archived') {
        matchConditions.isArchived = false;
    }
    let filterTaskWorkspaceIdsObj = [];
    for (let i = 0; i < filterTaskWorkspaceIds.length; i++) {
        const elementStr = filterTaskWorkspaceIds[i];
        filterTaskWorkspaceIdsObj.push(getMongodbObjectOrNull(elementStr));
    }
    if (filterTaskWorkspaceIdsObj.length > 0) {
        matchConditions.taskWorkspaceId = { $in: filterTaskWorkspaceIdsObj };
    }
    tempStage = {
        $match: matchConditions
    };
    stateDocument.push(tempStage);

    // stage -> search
    if (searchQuery && searchQuery.length >= 1) {
        let searchQueryArr = searchQuery
            .replace('-', ' ')
            .split(' ')
            .filter(str => str.length > 0);

        // stage -> lookup -> comments
        const lookupMatchCommentsAnd = [];
        for (let iLookup = 0; iLookup < searchQueryArr.length; iLookup++) {
            const elementStr = searchQueryArr[iLookup];
            lookupMatchCommentsAnd.push({ commentText: { $regex: elementStr, $options: 'i' } });
        }
        tempStage = {
            $lookup: {
                from: 'commentsCommon',
                let: { taskId: '$_id' },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $eq: ['$entityId', '$$taskId']
                            },
                            $or: [
                                ...lookupMatchCommentsAnd,
                            ],
                        }
                    }
                ],
                as: 'commentSearch',
            }
        };
        stateDocument.push(tempStage);

        const matchAnd = [];
        for (let index = 0; index < searchQueryArr.length; index++) {
            const elementStr = searchQueryArr[index];
            matchAnd.push({
                $or: [
                    // tasks
                    { title: { $regex: elementStr, $options: 'i' } },
                    { description: { $regex: elementStr, $options: 'i' } },
                    { priority: { $regex: elementStr, $options: 'i' } },
                    { labels: { $regex: elementStr, $options: 'i' } },
                    { labelsAi: { $regex: elementStr, $options: 'i' } },

                    // comment search
                    { 'commentSearch.commentText': { $regex: elementStr, $options: 'i' } },
                ]
            });
        }

        tempStage = {
            $match: {
                $and: [
                    ...matchAnd,
                ],
            },
        };
        stateDocument.push(tempStage);

        // stage -> unset commentSearch
        tempStage = {
            $unset: [
                'commentSearch',
            ],
        };
        stateDocument.push(tempStage);
    }

    // stateDocument -> addFields -> fromCollection
    tempStage = {
        $addFields: {
            fromCollection: 'tasks',
        }
    };
    stateDocument.push(tempStage);

    // stateDocument -> project
    tempStage = {
        $project: {
            _id: 1,
            fromCollection: 1,
            updatedAtUtcSort: '$updatedAtUtc',
            taskInfo: "$$ROOT"
        }
    };
    stateDocument.push(tempStage);

    return stateDocument;
}

const getSearchResultFromLifeEvents = ({
    username,
    searchQuery,
    filterLifeEventSearchDiary,
}: {
    username: string;
    searchQuery: string;
    filterLifeEventSearchDiary: boolean;
}) => {
    type PipelineStageCustom = PipelineStage.Match | PipelineStage.AddFields | PipelineStage.Lookup | PipelineStage.Project | PipelineStage.Unset;

    let tempStage = {} as PipelineStageCustom;
    const stateDocument = [] as PipelineStageCustom[];

    // stateDocument -> match
    const matchConditions: any = {
        username: username,
    };
    if (filterLifeEventSearchDiary === false) {
        matchConditions.title = {
            $not: {
                $regex: '(Daily|Weekly|Monthly) Summary by AI',
                $options: 'i',
            }
        };
    }

    tempStage = {
        $match: matchConditions
    };
    stateDocument.push(tempStage);

    // stage -> search
    if (searchQuery && searchQuery.length >= 1) {
        let searchQueryArr = searchQuery
            .replace('-', ' ')
            .split(' ')
            .filter(str => str.length > 0);

        // stage -> lookup -> comments
        const lookupMatchCommentsAnd = [];
        for (let iLookup = 0; iLookup < searchQueryArr.length; iLookup++) {
            const elementStr = searchQueryArr[iLookup];
            lookupMatchCommentsAnd.push({ commentText: { $regex: elementStr, $options: 'i' } });
        }
        tempStage = {
            $lookup: {
                from: 'commentsCommon',
                let: { lifeEventId: '$_id' },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $eq: ['$entityId', '$$lifeEventId']
                            },
                            $or: [
                                ...lookupMatchCommentsAnd,
                            ],
                        }
                    }
                ],
                as: 'commentSearch',
            }
        };
        stateDocument.push(tempStage);

        const matchAnd = [];
        for (let index = 0; index < searchQueryArr.length; index++) {
            const elementStr = searchQueryArr[index];
            matchAnd.push({
                $or: [
                    // life events
                    { title: { $regex: elementStr, $options: 'i' } },
                    { description: { $regex: elementStr, $options: 'i' } },
                    { tags: { $regex: elementStr, $options: 'i' } },
                    { aiSummary: { $regex: elementStr, $options: 'i' } },
                    { aiTags: { $regex: elementStr, $options: 'i' } },
                    { aiSuggestions: { $regex: elementStr, $options: 'i' } },
                    { aiCategory: { $regex: elementStr, $options: 'i' } },
                    { aiSubCategory: { $regex: elementStr, $options: 'i' } },

                    // comment search
                    { 'commentSearch.commentText': { $regex: elementStr, $options: 'i' } },
                ]
            });
        }

        tempStage = {
            $match: {
                $and: [
                    ...matchAnd,
                ],
            },
        };
        stateDocument.push(tempStage);

        // stage -> unset commentSearch
        tempStage = {
            $unset: [
                'commentSearch',
            ],
        };
        stateDocument.push(tempStage);
    }

    // stateDocument -> addFields -> fromCollection
    tempStage = {
        $addFields: {
            fromCollection: 'lifeEvents',
        }
    };
    stateDocument.push(tempStage);

    // stateDocument -> project
    tempStage = {
        $project: {
            _id: 1,
            fromCollection: 1,
            updatedAtUtcSort: '$updatedAtUtc',
            lifeEventInfo: "$$ROOT"
        }
    };
    stateDocument.push(tempStage);

    return stateDocument;
}

const getSearchResultFromNotes = ({
    username,
    searchQuery,

    // filter -> note
    filterNotesWorkspaceIds,
}: {
    username: string;
    searchQuery: string;

    // filter -> note
    filterNotesWorkspaceIds: string[];
}) => {
    type PipelineStageCustom = PipelineStage.Match | PipelineStage.AddFields | PipelineStage.Lookup | PipelineStage.Project | PipelineStage.Unset;

    let tempStage = {} as PipelineStageCustom;
    const stateDocument = [] as PipelineStageCustom[];

    // stateDocument -> match
    const matchConditions: any = {
        username: username,
    };
    let filterNotesWorkspaceIdsObj = [];
    for (let i = 0; i < filterNotesWorkspaceIds.length; i++) {
        const elementStr = filterNotesWorkspaceIds[i];
        filterNotesWorkspaceIdsObj.push(getMongodbObjectOrNull(elementStr));
    }
    if (filterNotesWorkspaceIdsObj.length > 0) {
        matchConditions.notesWorkspaceId = { $in: filterNotesWorkspaceIdsObj } as any;
    }
    tempStage = {
        $match: matchConditions
    };
    stateDocument.push(tempStage);

    // stage -> search
    if (searchQuery && searchQuery.length >= 1) {
        let searchQueryArr = searchQuery
            .replace('-', ' ')
            .split(' ')
            .filter(str => str.length > 0);

        // stage -> lookup -> comments
        const lookupMatchCommentsAnd = [];
        for (let iLookup = 0; iLookup < searchQueryArr.length; iLookup++) {
            const elementStr = searchQueryArr[iLookup];
            lookupMatchCommentsAnd.push({ commentText: { $regex: elementStr, $options: 'i' } });
        }
        tempStage = {
            $lookup: {
                from: 'commentsCommon',
                let: { noteId: '$_id' },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $eq: ['$entityId', '$$noteId']
                            },
                            $or: [
                                ...lookupMatchCommentsAnd,
                            ],
                        }
                    }
                ],
                as: 'commentSearch',
            }
        };
        stateDocument.push(tempStage);

        const matchAnd = [];
        for (let index = 0; index < searchQueryArr.length; index++) {
            const elementStr = searchQueryArr[index];
            matchAnd.push({
                $or: [
                    // notes
                    { title: { $regex: elementStr, $options: 'i' } },
                    { description: { $regex: elementStr, $options: 'i' } },
                    { aiSummary: { $regex: elementStr, $options: 'i' } },
                    { aiTags: { $regex: elementStr, $options: 'i' } },
                    { aiSuggestions: { $regex: elementStr, $options: 'i' } },

                    // comment search
                    { 'commentSearch.commentText': { $regex: elementStr, $options: 'i' } },
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

        // stage -> unset commentSearch
        tempStage = {
            $unset: [
                'commentSearch',
            ],
        };
        stateDocument.push(tempStage);
    }

    // stateDocument -> addFields -> fromCollection
    tempStage = {
        $addFields: {
            fromCollection: 'notes',
        }
    };
    stateDocument.push(tempStage);

    // stateDocument -> project
    tempStage = {
        $project: {
            _id: 1,
            fromCollection: 1,
            updatedAtUtcSort: '$updatedAtUtc',
            notesInfo: "$$ROOT"
        }
    };
    stateDocument.push(tempStage);

    return stateDocument;
}

const getSearchResultFromInfoVaultSignificantDate = ({
    username,
    searchQuery,
}: {
    username: string;
    searchQuery: string;
}) => {
    type PipelineStageCustom = PipelineStage.Match | PipelineStage.AddFields | PipelineStage.Lookup | PipelineStage.Project | PipelineStage.Unset;

    let tempStage = {} as PipelineStageCustom;
    const stateDocument = [] as PipelineStageCustom[];

    // stateDocument -> match
    const matchConditions: any = {
        username: username,
    };
    tempStage = {
        $match: matchConditions
    };
    stateDocument.push(tempStage);

    // stage -> search
    if (searchQuery && searchQuery.length >= 1) {
        let searchQueryArr = searchQuery
            .replace('-', ' ')
            .split(' ')
            .filter(str => str.length > 0);

        // stage -> lookup -> comments
        const lookupMatchCommentsAnd = [];
        for (let iLookup = 0; iLookup < searchQueryArr.length; iLookup++) {
            const elementStr = searchQueryArr[iLookup];
            lookupMatchCommentsAnd.push({ commentText: { $regex: elementStr, $options: 'i' } });
        }
        tempStage = {
            $lookup: {
                from: 'commentsCommon',
                let: { infoVaultId: '$_id' },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $eq: ['$entityId', '$$infoVaultId']
                            },
                            $or: [
                                ...lookupMatchCommentsAnd,
                            ],
                        }
                    }
                ],
                as: 'commentSearch',
            }
        };
        stateDocument.push(tempStage);

        const matchAnd = [];
        for (let index = 0; index < searchQueryArr.length; index++) {
            const elementStr = searchQueryArr[index];
            matchAnd.push({
                $or: [
                    // info vault
                    { title: { $regex: elementStr, $options: 'i' } },
                    { description: { $regex: elementStr, $options: 'i' } },
                    { tags: { $regex: elementStr, $options: 'i' } },
                    { name: { $regex: elementStr, $options: 'i' } },
                    { nickname: { $regex: elementStr, $options: 'i' } },
                    { company: { $regex: elementStr, $options: 'i' } },
                    { jobTitle: { $regex: elementStr, $options: 'i' } },
                    { department: { $regex: elementStr, $options: 'i' } },
                    { notes: { $regex: elementStr, $options: 'i' } },
                    { aiSummary: { $regex: elementStr, $options: 'i' } },
                    { aiTags: { $regex: elementStr, $options: 'i' } },
                    { aiSuggestions: { $regex: elementStr, $options: 'i' } },

                    // comment search
                    { 'commentSearch.commentText': { $regex: elementStr, $options: 'i' } },
                ]
            });
        }

        tempStage = {
            $match: {
                $and: [
                    ...matchAnd,
                ],
            },
        };
        stateDocument.push(tempStage);

        // stage -> unset commentSearch
        tempStage = {
            $unset: [
                'commentSearch',
            ],
        };
        stateDocument.push(tempStage);
    }

    // stateDocument -> addFields -> fromCollection
    tempStage = {
        $addFields: {
            fromCollection: 'infoVaultSignificantDate',
        }
    };
    stateDocument.push(tempStage);

    // stateDocument -> project
    tempStage = {
        $project: {
            _id: 1,
            fromCollection: 1,
            updatedAtUtcSort: '$updatedAtUtc',
            infoVaultSignificantDate: "$$ROOT"
        }
    };
    stateDocument.push(tempStage);

    return stateDocument;
}

const getSearchResultFromInfoVaultSignificantDateRepeat = ({
    username,
    searchQuery,
}: {
    username: string;
    searchQuery: string;
}) => {
    type PipelineStageCustom = PipelineStage.Match | PipelineStage.AddFields | PipelineStage.Lookup | PipelineStage.Project | PipelineStage.Unset;

    let tempStage = {} as PipelineStageCustom;
    const stateDocument = [] as PipelineStageCustom[];

    // stateDocument -> match
    const matchConditions: any = {
        username: username,
    };
    tempStage = {
        $match: matchConditions
    };
    stateDocument.push(tempStage);

    // stage -> search
    if (searchQuery && searchQuery.length >= 1) {
        let searchQueryArr = searchQuery
            .replace('-', ' ')
            .split(' ')
            .filter(str => str.length > 0);

        // stage -> lookup -> comments
        const lookupMatchCommentsAnd = [];
        for (let iLookup = 0; iLookup < searchQueryArr.length; iLookup++) {
            const elementStr = searchQueryArr[iLookup];
            lookupMatchCommentsAnd.push({ commentText: { $regex: elementStr, $options: 'i' } });
        }
        tempStage = {
            $lookup: {
                from: 'commentsCommon',
                let: { infoVaultId: '$_id' },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $eq: ['$entityId', '$$infoVaultId']
                            },
                            $or: [
                                ...lookupMatchCommentsAnd,
                            ],
                        }
                    }
                ],
                as: 'commentSearch',
            }
        };
        stateDocument.push(tempStage);

        const matchAnd = [];
        for (let index = 0; index < searchQueryArr.length; index++) {
            const elementStr = searchQueryArr[index];
            matchAnd.push({
                $or: [
                    // info vault
                    { title: { $regex: elementStr, $options: 'i' } },
                    { description: { $regex: elementStr, $options: 'i' } },
                    { tags: { $regex: elementStr, $options: 'i' } },
                    { name: { $regex: elementStr, $options: 'i' } },
                    { nickname: { $regex: elementStr, $options: 'i' } },
                    { company: { $regex: elementStr, $options: 'i' } },
                    { jobTitle: { $regex: elementStr, $options: 'i' } },
                    { department: { $regex: elementStr, $options: 'i' } },
                    { notes: { $regex: elementStr, $options: 'i' } },
                    { aiSummary: { $regex: elementStr, $options: 'i' } },
                    { aiTags: { $regex: elementStr, $options: 'i' } },
                    { aiSuggestions: { $regex: elementStr, $options: 'i' } },

                    // comment search
                    { 'commentSearch.commentText': { $regex: elementStr, $options: 'i' } },
                ]
            });
        }

        tempStage = {
            $match: {
                $and: [
                    ...matchAnd,
                ],
            },
        };
        stateDocument.push(tempStage);

        // stage -> unset commentSearch
        tempStage = {
            $unset: [
                'commentSearch',
            ],
        };
        stateDocument.push(tempStage);
    }

    // stateDocument -> addFields -> fromCollection
    tempStage = {
        $addFields: {
            fromCollection: 'infoVaultSignificantDateRepeat',
        }
    };
    stateDocument.push(tempStage);

    // stateDocument -> project
    tempStage = {
        $project: {
            _id: 1,
            fromCollection: 1,
            updatedAtUtcSort: '$updatedAtUtc',
            infoVaultSignificantDateRepeat: "$$ROOT",
        }
    };
    stateDocument.push(tempStage);

    return stateDocument;
}

const getSearchResultFromChatLlm = ({
    username,
    searchQuery,
}: {
    username: string;
    searchQuery: string;
}) => {
    type PipelineStageCustom = PipelineStage.Match | PipelineStage.AddFields | PipelineStage.Lookup | PipelineStage.Project | PipelineStage.Unset;

    let tempStage = {} as PipelineStageCustom;
    const stateDocument = [] as PipelineStageCustom[];

    // stateDocument -> match
    const matchConditions: any = {
        username: username,
    };
    tempStage = {
        $match: matchConditions
    };
    stateDocument.push(tempStage);

    // stage -> search
    if (searchQuery && searchQuery.length >= 1) {
        // lookup -> chatLlm
        tempStage = {
            $lookup: {
                from: 'chatLlm',
                localField: '_id',
                foreignField: 'threadId',
                as: 'chatLlm',
            }
        };
        stateDocument.push(tempStage);

        let searchQueryArr = searchQuery
            .replace('-', ' ')
            .split(' ')
            .filter(str => str.length > 0);

        const matchAnd = [];
        for (let index = 0; index < searchQueryArr.length; index++) {
            const elementStr = searchQueryArr[index];
            matchAnd.push({
                $or: [
                    // chat llm thread
                    { threadTitle: { $regex: elementStr, $options: 'i' } },
                    { tagsAi: { $regex: elementStr, $options: 'i' } },
                    { aiSummary: { $regex: elementStr, $options: 'i' } },
                    { systemPrompt: { $regex: elementStr, $options: 'i' } },

                    // chat llm messages
                    { 'chatLlm.content': { $regex: elementStr, $options: 'i' } },
                    { 'chatLlm.fileContentAi': { $regex: elementStr, $options: 'i' } },
                ]
            });
        }

        tempStage = {
            $match: {
                $and: [
                    ...matchAnd,
                ],
            },
        };
        stateDocument.push(tempStage);

        // stage -> unset chatLlm
        tempStage = {
            $unset: [
                'chatLlm',
            ],
        };
        stateDocument.push(tempStage);
    }

    // stateDocument -> addFields -> fromCollection
    tempStage = {
        $addFields: {
            fromCollection: 'chatLlmThread',
        }
    };
    stateDocument.push(tempStage);

    // stateDocument -> project
    tempStage = {
        $project: {
            _id: 1,
            fromCollection: 1,
            updatedAtUtcSort: '$updatedAtUtc',
            chatLlmThreadInfo: "$$ROOT",
        }
    };
    stateDocument.push(tempStage);

    return stateDocument;
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

            let tempStage = {} as PipelineStage;
            const stageDocument = [] as PipelineStage[];
            const stageCount = [] as PipelineStage[];

            // stateDocument -> unionWith
            if (filterEventTypeTasks) {
                tempStage = {
                    $unionWith: {
                        coll: 'tasks',
                        pipeline: getSearchResultFromTasks({
                            username: res.locals.auth_username,
                            searchQuery,

                            // filter -> task
                            filterTaskIsCompleted,
                            filterTaskIsArchived,
                            filterTaskWorkspaceIds,
                        }),
                    }
                };
                stageDocument.push(tempStage);
                stageCount.push(tempStage);
            }

            if (filterEventTypeLifeEvents) {
                // stateDocument -> unionWith
                tempStage = {
                    $unionWith: {
                        coll: 'lifeEvents',
                        pipeline: getSearchResultFromLifeEvents({
                            username: res.locals.auth_username,
                            searchQuery,

                            // filter -> life event
                            filterLifeEventSearchDiary,
                        }),
                    }
                };
                stageDocument.push(tempStage);
                stageCount.push(tempStage);
            }

            if (filterEventTypeNotes) {
                // stateDocument -> unionWith
                tempStage = {
                    $unionWith: {
                        coll: 'notes',
                        pipeline: getSearchResultFromNotes({
                            username: res.locals.auth_username,
                            searchQuery,

                            // filter -> note
                            filterNotesWorkspaceIds,
                        }),
                    }
                };
                stageDocument.push(tempStage);
                stageCount.push(tempStage);
            }

            // stateDocument -> unionWith
            if (filterEventTypeInfoVault) {
                tempStage = {
                    $unionWith: {
                        coll: 'infoVaultSignificantDate',
                        pipeline: getSearchResultFromInfoVaultSignificantDate({
                            username: res.locals.auth_username,
                            searchQuery,
                        }),
                    }
                };
                stageDocument.push(tempStage);
                stageCount.push(tempStage);
            }

            // stateDocument -> unionWith
            if (filterEventTypeInfoVault) {
                tempStage = {
                    $unionWith: {
                        coll: 'infoVaultSignificantDate',
                        pipeline: getSearchResultFromInfoVaultSignificantDateRepeat({
                            username: res.locals.auth_username,
                            searchQuery,
                        }),
                    }
                };
                stageDocument.push(tempStage);
                stageCount.push(tempStage);
            }

            // stateDocument -> unionWith
            if (filterEventTypeChatLlm) {
                tempStage = {
                    $unionWith: {
                        coll: 'chatLlmThread',
                        pipeline: getSearchResultFromChatLlm({
                            username: res.locals.auth_username,
                            searchQuery,
                        }),
                    }
                };
                stageDocument.push(tempStage);
                stageCount.push(tempStage);
            }

            // stateDocument -> sort
            tempStage = {
                $sort: {
                    updatedAtUtcSort: -1,
                },
            };
            stageDocument.push(tempStage);
            stageCount.push(tempStage);

            // stateDocument -> skip
            tempStage = {
                $skip: (page - 1) * perPage,
            };
            stageDocument.push(tempStage);

            // stateDocument -> limit
            tempStage = {
                $limit: perPage,
            };
            stageDocument.push(tempStage);

            // stageCount -> count
            stageCount.push({
                $count: 'count',
            });

            // pipeline
            const resultDocs = await ModelRecordEmptyTable.aggregate(stageDocument);
            const resultCount = await ModelRecordEmptyTable.aggregate(stageCount);

            let resultDocsFinal = resultDocs.map((doc) => {
                if (doc.fromCollection === 'notes') {
                    if(doc?.notesInfo && doc?.notesInfo?.description && doc?.notesInfo?.description.length >= 1) {
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

            let totalCount = 0;
            if (resultCount.length === 1) {
                if (resultCount[0].count) {
                    totalCount = resultCount[0].count;
                }
            }

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

export default router;