import mongoose, { PipelineStage } from 'mongoose';

import { ModelRecordEmptyTable } from '../../../../schema/schemaOther/NoRecordTable';
import { ModelChatLlmThreadContextReference } from '../../../../schema/schemaChatLlm/SchemaChatLlmThreadContextReference.schema';
import { getMongodbObjectOrNull } from '../../../../utils/common/getMongodbObjectOrNull';

const getContextFromTasks = ({
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
            .split(' ');

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

const getContextFromNotes = ({
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
            .split(' ');

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

const getContextFromLifeEvents = ({
    username,
    filterEventTypeDiary,
    searchQuery,
}: {
    username: string;
    filterEventTypeDiary: boolean;
    searchQuery: string;
}) => {
    type PipelineStageCustom = PipelineStage.Match | PipelineStage.AddFields | PipelineStage.Lookup | PipelineStage.Project | PipelineStage.Unset;

    let tempStage = {} as PipelineStageCustom;
    const stateDocument = [] as PipelineStageCustom[];

    // stateDocument -> match
    const matchConditions: any = {
        username: username,
    };
    if (filterEventTypeDiary === false) {
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
            .split(' ');

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

const searchContext = async ({
    username,
    threadId,
    searchQuery,

    // filter
    filterEventTypeTasks,
    filterEventTypeLifeEvents,
    filterEventTypeNotes,
    filterEventTypeDiary,
    filterIsContextSelected,

    // pagination
    page,
    limit,
}: {
    username: string;
    threadId: string;
    searchQuery: string;

    filterEventTypeTasks: boolean;
    filterEventTypeLifeEvents: boolean;
    filterEventTypeNotes: boolean;
    filterEventTypeDiary: boolean;
    filterIsContextSelected: 'all' | 'added' | 'not-added';

    // pagination
    page: number;
    limit: number;
}) => {
    try {
        let tempStage = {} as PipelineStage;
        const stateDocument = [] as PipelineStage[];
        const stateCount = [] as PipelineStage[];

        // stateDocument -> unionWith
        if (filterEventTypeTasks) {
            tempStage = {
                $unionWith: {
                    coll: 'tasks',
                    pipeline: getContextFromTasks({
                        username,
                        searchQuery,
                    }),
                }
            };
            stateDocument.push(tempStage);
            stateCount.push(tempStage);
        }

        if (filterEventTypeLifeEvents) {
            // stateDocument -> unionWith
            tempStage = {
                $unionWith: {
                    coll: 'lifeEvents',
                    pipeline: getContextFromLifeEvents({
                        username,

                        // 
                        filterEventTypeDiary,
                        searchQuery,
                    }),
                }
            };
            stateDocument.push(tempStage);
            stateCount.push(tempStage);
        }

        if (filterEventTypeNotes) {
            // stateDocument -> unionWith
            tempStage = {
                $unionWith: {
                    coll: 'notes',
                    pipeline: getContextFromNotes({
                        username,
                        searchQuery,
                    }),
                }
            };
            stateDocument.push(tempStage);
            stateCount.push(tempStage);
        }

        // stateCount -> match -> filterIsContextSelected
        const resultContextReferences = await ModelChatLlmThreadContextReference.aggregate([
            {
                $match: {
                    threadId: getMongodbObjectOrNull(threadId),
                    username: username,
                },
            },
            {
                $project: {
                    referenceId: 1,
                },
            },
        ]);
        if (filterIsContextSelected === 'added' || filterIsContextSelected === 'not-added') {
            // Build arrays of referenceIds grouped by referenceFrom type
            const addedReferenceIds = [] as mongoose.Types.ObjectId[];
            resultContextReferences.forEach((ref) => {
                if (ref.referenceId) {
                    addedReferenceIds.push(ref.referenceId);
                }
            });

            // Apply filter based on whether context is added or not
            if (filterIsContextSelected === 'added') {
                // Filter to only show items that ARE in the context references
                tempStage = {
                    $match: {
                        _id: {
                            $in: addedReferenceIds,
                        },
                    },
                };
                stateDocument.push(tempStage);
                stateCount.push(tempStage);
            } else if (filterIsContextSelected === 'not-added') {
                // Filter to only show items that are NOT in the context references
                tempStage = {
                    $match: {
                        _id: {
                            $nin: addedReferenceIds,
                        },
                    },
                };
                stateDocument.push(tempStage);
                stateCount.push(tempStage);
            }
        }

        // stateDocument -> sort
        tempStage = {
            $sort: {
                updatedAtUtcSort: -1,
            },
        };
        stateDocument.push(tempStage);
        stateCount.push(tempStage);

        // stateDocument -> skip
        tempStage = {
            $skip: (page - 1) * limit,
        };
        stateDocument.push(tempStage);

        // stateDocument -> limit
        tempStage = {
            $limit: limit,
        };
        stateDocument.push(tempStage);

        // stateCount -> count
        stateCount.push({
            $count: 'count',
        });

        // pipeline
        const resultRecordEmptyTable = await ModelRecordEmptyTable.aggregate(stateDocument);
        const resultCount = await ModelRecordEmptyTable.aggregate(stateCount);

        let resultDocs = [] as object[];
        resultRecordEmptyTable.forEach((doc) => {
            let isContextSelected = false;
            let contextSelectedId = '';

            resultContextReferences.forEach((ref) => {
                if (ref.referenceId && ref.referenceId.equals(doc._id)) {
                    isContextSelected = true;
                    contextSelectedId = ref._id.toString();
                }
            });

            resultDocs.push({
                ...doc,
                isContextSelected,
                contextSelectedId,
            });
        });

        let totalCount = 0;
        if (resultCount.length === 1) {
            if (resultCount[0].count) {
                totalCount = resultCount[0].count;
            }
        }

        return {
            message: 'Context retrieved successfully',
            count: totalCount,
            docs: resultDocs,
        };
    } catch (error) {
        console.error(error);
        return {
            message: 'Server error',
            count: 0,
            docs: [],
        }
    }
}

export default searchContext;