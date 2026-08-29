import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';

import { ModelRecordEmptyTable } from '../../schema/schemaOther/NoRecordTable';
import {
    getChatMediaAttachmentsLookupStage,
    getCommentMediaAttachmentsLookupStage,
    getInfoVaultMediaAttachmentsStages,
    getMemoMediaAttachmentsLookupStage,
    timelineNormalizeStage,
} from '../../utils/timeline/timelineNormalize';

const router = Router();

type TimelineCollection =
    | 'tasks'
    | 'notes'
    | 'lifeEvents'
    | 'infoVault'
    | 'chatLlmThread'
    | 'memoNotes';

const entityTypeMap = {
    tasks: 'task',
    notes: 'note',
    lifeEvents: 'lifeEvent',
    chatLlmThread: 'chatLlmThread',
    infoVault: 'infoVault',
    memoNotes: 'memo',
} as const;

const getMediaLookupStages = (
    userId: unknown,
    collectionName: TimelineCollection
): PipelineStage[] => {
    switch (collectionName) {
        case 'tasks':
        case 'notes':
        case 'lifeEvents':
            return [getCommentMediaAttachmentsLookupStage(userId)];
        case 'infoVault':
            return getInfoVaultMediaAttachmentsStages(userId);
        case 'chatLlmThread':
            return [getChatMediaAttachmentsLookupStage(userId)];
        case 'memoNotes':
            return [getMemoMediaAttachmentsLookupStage(userId)];
        default:
            return [
                {
                    $addFields: {
                        mediaAttachments: [],
                    },
                },
            ];
    }
};

const getUnionPipeline = ({
    userId,
    collectionName,
}: {
    userId: unknown;
    collectionName: TimelineCollection;
}) => {
    const pipeline: any[] = [
        {
            $match: {
                userId,
            },
        },
        {
            $addFields: {
                entityType: entityTypeMap[collectionName],
                entityId: '$_id',
            },
        },
        ...getMediaLookupStages(userId, collectionName),
    ];

    // Soft-deleted / trashed memos stay out of the main timeline
    if (collectionName === 'memoNotes') {
        pipeline.splice(1, 0, {
            $match: {
                trashed: { $ne: true },
            },
        });
    }

    return {
        $unionWith: {
            coll: collectionName,
            pipeline,
        },
    } as PipelineStage;
};

const toId = (value: unknown) => {
    if (value instanceof mongoose.Types.ObjectId) return value.toString();
    if (typeof value === 'string') return value;
    return value != null ? String(value) : '';
};

const serializeMediaAttachment = (attachment: Record<string, unknown>) => ({
    _id: toId(attachment._id),
    fileType: attachment.fileType || '',
    fileUrl: attachment.fileUrl || '',
    fileTitle: attachment.fileTitle || '',
    fileDescription: attachment.fileDescription || '',
    commentText: attachment.commentText || '',
    createdAtUtc: attachment.createdAtUtc || null,
    updatedAtUtc: attachment.updatedAtUtc || null,
});

const serializeTimelineDoc = (doc: Record<string, unknown>) => {
    const mediaAttachmentsRaw = Array.isArray(doc.mediaAttachments)
        ? (doc.mediaAttachments as Record<string, unknown>[])
        : [];

    const mediaAttachments = mediaAttachmentsRaw.map(serializeMediaAttachment);

    return {
        ...doc,
        _id: toId(doc._id),
        entityId: toId(doc.entityId),
        parentEntityId: doc.parentEntityId ? toId(doc.parentEntityId) : toId(doc._id),
        workspaceId: doc.workspaceId ? toId(doc.workspaceId) : undefined,
        updatedAtUtc: doc.updatedAtUtc,
        createdAtUtc: doc.createdAtUtc,
        title: doc.title || '',
        content: doc.content || '',
        fileType: doc.mediaFileType || doc.fileType || '',
        fileUrl: doc.mediaFileUrl || doc.fileUrl || '',
        fileTitle: doc.mediaFileTitle || doc.fileTitle || '',
        fileDescription: doc.fileDescription || '',
        photoUrl: doc.photoUrl || '',
        parentEntityType: doc.parentEntityType || doc.entityType,
        isAi: doc.isAi ?? false,
        mediaAttachments,
        mediaFileType: undefined,
        mediaFileUrl: undefined,
        mediaFileTitle: undefined,
        commentId: undefined,
        _parentTask: undefined,
        _parentNote: undefined,
    };
};

router.post('/timelineGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let page = 1;
        let perPage = 20;

        if (typeof req.body?.page === 'number' && req.body.page >= 1) {
            page = req.body.page;
        }
        if (typeof req.body?.perPage === 'number' && req.body.perPage >= 1) {
            perPage = Math.min(req.body.perPage, 100);
        }

        const userId = res.locals.auth_userId;
        let tempStage = {} as PipelineStage;
        const pipelineDocument: PipelineStage[] = [];
        const pipelineCount: PipelineStage[] = [];

        const unionCollections: TimelineCollection[] = [
            'tasks',
            'notes',
            'lifeEvents',
            'chatLlmThread',
            'infoVault',
            'memoNotes',
        ];

        for (const collectionName of unionCollections) {
            pipelineDocument.push(getUnionPipeline({ userId, collectionName }));
            pipelineCount.push(getUnionPipeline({ userId, collectionName }));
        }

        // Comments are not separate timeline rows — their files appear on the parent entity.
        pipelineDocument.push(timelineNormalizeStage);
        pipelineCount.push(timelineNormalizeStage);

        tempStage = { $sort: { updatedAtUtc: -1 } };
        pipelineDocument.push(tempStage);
        pipelineCount.push(tempStage);

        tempStage = { $skip: (page - 1) * perPage };
        pipelineDocument.push(tempStage);

        tempStage = { $limit: perPage };
        pipelineDocument.push(tempStage);

        tempStage = { $count: 'count' };
        pipelineCount.push(tempStage);

        const resultTimeline = await ModelRecordEmptyTable.aggregate(pipelineDocument);
        const countResult = await ModelRecordEmptyTable.aggregate(pipelineCount);
        const totalCount = countResult.length > 0 ? countResult[0]?.count || 0 : 0;

        return res.json({
            message: 'Timeline retrieved successfully',
            docs: resultTimeline.map((doc) =>
                serializeTimelineDoc(doc as Record<string, unknown>)
            ),
            count: totalCount,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;
