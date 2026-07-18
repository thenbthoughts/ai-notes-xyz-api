import { PipelineStage } from 'mongoose';

const mediaAttachmentProjectFields = {
    _id: 1,
    fileType: 1,
    fileUrl: 1,
    fileTitle: 1,
    fileDescription: 1,
    commentText: 1,
    createdAtUtc: 1,
    updatedAtUtc: 1,
};

/** Guess coarse media type from a storage path extension. */
const fileTypeFromPathExpr = (pathField: string) => ({
    $let: {
        vars: {
            ext: {
                $toLower: {
                    $arrayElemAt: [{ $split: [{ $ifNull: [pathField, ''] }, '.'] }, -1],
                },
            },
        },
        in: {
            $switch: {
                branches: [
                    {
                        case: {
                            $in: ['$$ext', ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico']],
                        },
                        then: 'image',
                    },
                    {
                        case: {
                            $in: ['$$ext', ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv', 'm4v']],
                        },
                        then: 'video',
                    },
                    {
                        case: {
                            $in: ['$$ext', ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a']],
                        },
                        then: 'audio',
                    },
                ],
                default: 'file',
            },
        },
    },
});

const basenameFromPathExpr = (pathField: string) => ({
    $arrayElemAt: [{ $split: [{ $ifNull: [pathField, ''] }, '/'] }, -1],
});

/** Map chat message `type` to timeline media type. */
const chatTypeToMediaTypeExpr = {
    $switch: {
        branches: [
            { case: { $eq: ['$type', 'image'] }, then: 'image' },
            { case: { $eq: ['$type', 'video'] }, then: 'video' },
            { case: { $eq: ['$type', 'audio'] }, then: 'audio' },
            { case: { $eq: ['$type', 'document'] }, then: 'file' },
            { case: { $eq: ['$type', 'file'] }, then: 'file' },
        ],
        default: fileTypeFromPathExpr('$fileUrl'),
    },
};

/** Lookup comments that have file attachments for Task / Notes / Life Events / Info Vault. */
export const getCommentMediaAttachmentsLookupStage = (userId: unknown): PipelineStage => ({
    $lookup: {
        from: 'commentsCommon',
        let: { parentId: '$_id' },
        pipeline: [
            {
                $match: {
                    $expr: {
                        $and: [
                            { $eq: ['$entityId', '$$parentId'] },
                            { $eq: ['$userId', userId] },
                        ],
                    },
                    fileUrl: { $exists: true, $ne: '' },
                    fileType: { $exists: true, $ne: '' },
                },
            },
            { $sort: { updatedAtUtc: -1 } },
            { $project: mediaAttachmentProjectFields },
        ],
        as: 'mediaAttachments',
    },
});

/** Lookup chat message files for a chat thread. */
export const getChatMediaAttachmentsLookupStage = (userId: unknown): PipelineStage => ({
    $lookup: {
        from: 'chatLlm',
        let: { threadId: '$_id' },
        pipeline: [
            {
                $match: {
                    $expr: {
                        $and: [
                            { $eq: ['$threadId', '$$threadId'] },
                            { $eq: ['$userId', userId] },
                            {
                                $or: [
                                    { $ne: [{ $ifNull: ['$fileUrl', ''] }, ''] },
                                    {
                                        $gt: [
                                            { $size: { $ifNull: ['$fileUrlArr', []] } },
                                            0,
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
            { $sort: { updatedAtUtc: -1 } },
            {
                $project: {
                    attachments: {
                        $concatArrays: [
                            {
                                $cond: [
                                    {
                                        $and: [
                                            { $ne: [{ $ifNull: ['$fileUrl', ''] }, ''] },
                                        ],
                                    },
                                    [
                                        {
                                            _id: '$_id',
                                            fileType: chatTypeToMediaTypeExpr,
                                            fileUrl: '$fileUrl',
                                            fileTitle: {
                                                $ifNull: [
                                                    basenameFromPathExpr('$fileUrl'),
                                                    { $ifNull: ['$content', 'Chat file'] },
                                                ],
                                            },
                                            fileDescription: { $ifNull: ['$content', ''] },
                                            commentText: { $ifNull: ['$content', ''] },
                                            createdAtUtc: '$createdAtUtc',
                                            updatedAtUtc: '$updatedAtUtc',
                                        },
                                    ],
                                    [],
                                ],
                            },
                            {
                                $map: {
                                    input: {
                                        $filter: {
                                            input: { $ifNull: ['$fileUrlArr', []] },
                                            as: 'arrUrl',
                                            cond: {
                                                $and: [
                                                    { $ne: ['$$arrUrl', ''] },
                                                    { $ne: ['$$arrUrl', '$fileUrl'] },
                                                ],
                                            },
                                        },
                                    },
                                    as: 'arrUrl',
                                    in: {
                                        _id: '$_id',
                                        fileType: fileTypeFromPathExpr('$$arrUrl'),
                                        fileUrl: '$$arrUrl',
                                        fileTitle: basenameFromPathExpr('$$arrUrl'),
                                        fileDescription: { $ifNull: ['$content', ''] },
                                        commentText: { $ifNull: ['$content', ''] },
                                        createdAtUtc: '$createdAtUtc',
                                        updatedAtUtc: '$updatedAtUtc',
                                    },
                                },
                            },
                        ],
                    },
                },
            },
            { $unwind: '$attachments' },
            { $replaceRoot: { newRoot: '$attachments' } },
            { $limit: 50 },
        ],
        as: 'mediaAttachments',
    },
});

/** Lookup memo image/files for a memo note. */
export const getMemoMediaAttachmentsLookupStage = (userId: unknown): PipelineStage => ({
    $lookup: {
        from: 'memoFiles',
        let: { memoNoteId: '$_id' },
        pipeline: [
            {
                $match: {
                    $expr: {
                        $and: [
                            { $eq: ['$memoNoteId', '$$memoNoteId'] },
                            { $eq: ['$userId', userId] },
                        ],
                    },
                    filePath: { $exists: true, $ne: '' },
                },
            },
            { $sort: { sortOrder: 1, createdAtUtc: -1 } },
            {
                $project: {
                    _id: 1,
                    fileType: fileTypeFromPathExpr('$filePath'),
                    fileUrl: '$filePath',
                    fileTitle: basenameFromPathExpr('$filePath'),
                    fileDescription: '',
                    commentText: '',
                    createdAtUtc: '$createdAtUtc',
                    updatedAtUtc: '$createdAtUtc',
                },
            },
            { $limit: 50 },
        ],
        as: 'mediaAttachments',
    },
});

/**
 * For Info Vault: keep comment attachments and prepend photoUrl when present.
 */
export const getInfoVaultMediaAttachmentsStages = (userId: unknown): PipelineStage[] => [
    getCommentMediaAttachmentsLookupStage(userId),
    {
        $addFields: {
            mediaAttachments: {
                $cond: {
                    if: { $ne: [{ $ifNull: ['$photoUrl', ''] }, ''] },
                    then: {
                        $concatArrays: [
                            [
                                {
                                    _id: '$_id',
                                    fileType: 'image',
                                    fileUrl: '$photoUrl',
                                    fileTitle: { $ifNull: ['$name', 'Photo'] },
                                    fileDescription: '',
                                    commentText: '',
                                    createdAtUtc: '$createdAtUtc',
                                    updatedAtUtc: '$updatedAtUtc',
                                },
                            ],
                            { $ifNull: ['$mediaAttachments', []] },
                        ],
                    },
                    else: { $ifNull: ['$mediaAttachments', []] },
                },
            },
        },
    },
];

/**
 * For comment rows: resolve workspaceId from the parent note/task.
 */
export const getCommentWorkspaceLookupStages = (): PipelineStage[] => [
    {
        $lookup: {
            from: 'tasks',
            let: { parentId: '$entityId', commentType: '$commentType' },
            pipeline: [
                {
                    $match: {
                        $expr: {
                            $and: [
                                { $eq: ['$_id', '$$parentId'] },
                                { $eq: ['$$commentType', 'task'] },
                            ],
                        },
                    },
                },
                { $project: { taskWorkspaceId: 1 } },
                { $limit: 1 },
            ],
            as: '_parentTask',
        },
    },
    {
        $lookup: {
            from: 'notes',
            let: { parentId: '$entityId', commentType: '$commentType' },
            pipeline: [
                {
                    $match: {
                        $expr: {
                            $and: [
                                { $eq: ['$_id', '$$parentId'] },
                                { $eq: ['$$commentType', 'note'] },
                            ],
                        },
                    },
                },
                { $project: { notesWorkspaceId: 1 } },
                { $limit: 1 },
            ],
            as: '_parentNote',
        },
    },
    {
        $addFields: {
            taskWorkspaceId: {
                $ifNull: [{ $arrayElemAt: ['$_parentTask.taskWorkspaceId', 0] }, null],
            },
            notesWorkspaceId: {
                $ifNull: [{ $arrayElemAt: ['$_parentNote.notesWorkspaceId', 0] }, null],
            },
        },
    },
    {
        $unset: ['_parentTask', '_parentNote'],
    },
];

export const timelineNormalizeStage: PipelineStage = {
    $addFields: {
        title: {
            $switch: {
                branches: [
                    { case: { $eq: ['$entityType', 'task'] }, then: '$title' },
                    { case: { $eq: ['$entityType', 'note'] }, then: '$title' },
                    { case: { $eq: ['$entityType', 'lifeEvent'] }, then: '$title' },
                    { case: { $eq: ['$entityType', 'chatLlmThread'] }, then: '$threadTitle' },
                    { case: { $eq: ['$entityType', 'infoVault'] }, then: '$name' },
                    { case: { $eq: ['$entityType', 'memo'] }, then: '$title' },
                    {
                        case: { $eq: ['$entityType', 'comment'] },
                        then: {
                            $cond: {
                                if: {
                                    $and: [
                                        { $ne: [{ $ifNull: ['$fileTitle', ''] }, ''] },
                                    ],
                                },
                                then: '$fileTitle',
                                else: {
                                    $cond: {
                                        if: {
                                            $and: [
                                                { $ne: [{ $ifNull: ['$commentText', ''] }, ''] },
                                            ],
                                        },
                                        then: {
                                            $substrCP: [
                                                '$commentText',
                                                0,
                                                { $min: [{ $strLenCP: '$commentText' }, 120] },
                                            ],
                                        },
                                        else: {
                                            $concat: [
                                                'Attachment · ',
                                                { $ifNull: ['$fileType', 'file'] },
                                            ],
                                        },
                                    },
                                },
                            },
                        },
                    },
                ],
                default: '',
            },
        },
        content: {
            $switch: {
                branches: [
                    { case: { $eq: ['$entityType', 'task'] }, then: '$description' },
                    { case: { $eq: ['$entityType', 'note'] }, then: '$description' },
                    { case: { $eq: ['$entityType', 'lifeEvent'] }, then: '$description' },
                    { case: { $eq: ['$entityType', 'infoVault'] }, then: '$notes' },
                    { case: { $eq: ['$entityType', 'memo'] }, then: '$body' },
                    {
                        case: { $eq: ['$entityType', 'comment'] },
                        then: {
                            $cond: {
                                if: {
                                    $and: [
                                        { $ne: [{ $ifNull: ['$commentText', ''] }, ''] },
                                    ],
                                },
                                then: '$commentText',
                                else: {
                                    $cond: {
                                        if: {
                                            $and: [
                                                { $ne: [{ $ifNull: ['$fileDescription', ''] }, ''] },
                                            ],
                                        },
                                        then: '$fileDescription',
                                        else: '$fileTitle',
                                    },
                                },
                            },
                        },
                    },
                ],
                default: '',
            },
        },
        workspaceId: {
            $switch: {
                branches: [
                    { case: { $eq: ['$entityType', 'task'] }, then: '$taskWorkspaceId' },
                    { case: { $eq: ['$entityType', 'note'] }, then: '$notesWorkspaceId' },
                    {
                        case: { $eq: ['$entityType', 'comment'] },
                        then: {
                            $cond: {
                                if: { $eq: ['$commentType', 'task'] },
                                then: '$taskWorkspaceId',
                                else: {
                                    $cond: {
                                        if: { $eq: ['$commentType', 'note'] },
                                        then: '$notesWorkspaceId',
                                        else: null,
                                    },
                                },
                            },
                        },
                    },
                ],
                default: null,
            },
        },
        parentEntityType: {
            $cond: {
                if: { $eq: ['$entityType', 'comment'] },
                then: '$commentType',
                else: '$entityType',
            },
        },
        parentEntityId: {
            $cond: {
                if: { $eq: ['$entityType', 'comment'] },
                then: '$entityId',
                else: '$_id',
            },
        },
        commentId: {
            $cond: {
                if: { $eq: ['$entityType', 'comment'] },
                then: '$_id',
                else: null,
            },
        },
        mediaFileType: {
            $cond: {
                if: {
                    $and: [
                        { $ne: [{ $ifNull: ['$fileUrl', ''] }, ''] },
                        { $ne: [{ $ifNull: ['$fileType', ''] }, ''] },
                    ],
                },
                then: '$fileType',
                else: {
                    $cond: {
                        if: {
                            $gt: [{ $size: { $ifNull: ['$mediaAttachments', []] } }, 0],
                        },
                        then: {
                            $arrayElemAt: ['$mediaAttachments.fileType', 0],
                        },
                        else: '',
                    },
                },
            },
        },
        mediaFileUrl: {
            $cond: {
                if: {
                    $and: [
                        { $ne: [{ $ifNull: ['$fileUrl', ''] }, ''] },
                    ],
                },
                then: '$fileUrl',
                else: {
                    $cond: {
                        if: {
                            $gt: [{ $size: { $ifNull: ['$mediaAttachments', []] } }, 0],
                        },
                        then: {
                            $arrayElemAt: ['$mediaAttachments.fileUrl', 0],
                        },
                        else: '',
                    },
                },
            },
        },
        mediaFileTitle: {
            $cond: {
                if: {
                    $ne: [{ $ifNull: ['$fileTitle', ''] }, ''],
                },
                then: '$fileTitle',
                else: {
                    $cond: {
                        if: {
                            $gt: [{ $size: { $ifNull: ['$mediaAttachments', []] } }, 0],
                        },
                        then: {
                            $arrayElemAt: ['$mediaAttachments.fileTitle', 0],
                        },
                        else: '',
                    },
                },
            },
        },
    },
};

export const getCommentUnionPipeline = (userId: unknown): PipelineStage => {
    const pipeline: any[] = [
        {
            $match: {
                userId,
                $or: [
                    { fileUrl: { $exists: true, $ne: '' } },
                    { commentText: { $exists: true, $ne: '' } },
                ],
            },
        },
        {
            $addFields: {
                entityType: 'comment',
                mediaAttachments: [],
            },
        },
        ...getCommentWorkspaceLookupStages(),
    ];

    return {
        $unionWith: {
            coll: 'commentsCommon',
            pipeline,
        },
    };
};

/** @deprecated use getCommentMediaAttachmentsLookupStage */
export const getMediaAttachmentsLookupStage = getCommentMediaAttachmentsLookupStage;
