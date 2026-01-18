import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { ModelCommentCommon } from '../../schema/schemaCommentCommon/SchemaCommentCommon.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { normalizeDateTimeIpAddress } from '../../utils/llm/normalizeDateTimeIpAddress';
import middlewareActionDatetime from '../../middleware/middlewareActionDatetime';
import { getMongodbObjectOrNull } from '../../utils/common/getMongodbObjectOrNull';
import { reindexDocument } from '../../utils/search/reindexGlobalSearch';
import { deleteFileByPath } from '../upload/uploadFileS3ForFeatures';

// Router
const router = Router();

// Add Comment Common API
router.post(
    '/commentCommonAdd',
    middlewareUserAuth,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        try {
            const actionDatetimeObj = normalizeDateTimeIpAddress(
                res.locals.actionDatetime
            );
            console.log(actionDatetimeObj);

            const {
                commentText,
                commentType,
                entityId,

                // file fields
                fileType,
                fileUrl,
                fileTitle,
                fileDescription,
            } = req.body;
            const username = res.locals.auth_username;

            // validate comment type
            if (
                commentType === 'note' ||
                commentType === 'task' ||
                commentType === 'lifeEvent' ||
                commentType === 'infoVault'
            ) {
                // validate entityId
            } else {
                return res.status(400).json({ message: 'Invalid comment type. Must be one of: note, task, lifeEvent, infoVault.' });
            }

            let entityIdObj = getMongodbObjectOrNull(entityId);
            if (!entityIdObj) {
                return res.status(400).json({ message: 'Invalid entityId.' });
            }

            const newComment = await ModelCommentCommon.create({
                commentText,
                entityId: entityIdObj,
                commentType,
                username,

                // file fields
                fileType,
                fileUrl,
                fileTitle,
                fileDescription,

                // date time ip
                ...actionDatetimeObj,
            });

            // reindex parent entity when comment is added
            const collectionName = newComment.commentType as 'notes' | 'tasks' | 'lifeEvents' | 'infoVault' | 'chatLlmThread' | 'chatLlm';
            await reindexDocument({
                reindexDocumentArr: [{
                    collectionName: collectionName,
                    documentId: newComment.entityId.toString(),
                }],
            });

            return res.status(201).json(newComment);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Get Comment Commons API
router.post('/commentCommonGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const {
            entityId,
        } = req.body;
        const username = res.locals.auth_username;

        const resultComments = await ModelCommentCommon.find({
            entityId: mongoose.Types.ObjectId.createFromHexString(entityId),
            username,
        }).sort({ createdAtUtc: -1 });

        return res.json({
            message: 'Comment Commons retrieved successfully',
            count: resultComments.length,
            docs: resultComments,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Delete Comment Common API
router.post('/commentCommonDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const { id } = req.body;
        const username = res.locals.auth_username;

        const deletedComment = await ModelCommentCommon.findOneAndDelete({
            _id: mongoose.Types.ObjectId.createFromHexString(id),
            username,
        });

        // delete file from s3
        if (deletedComment?.fileUrl) {
            const fileUrlParts = deletedComment.fileUrl.split('/');
            const fileName = fileUrlParts[fileUrlParts.length - 1];
            if (fileName) {
                await deleteFileByPath({
                    username,
                    parentEntityId: deletedComment?.entityId?.toString() || '',
                    fileName: fileName,
                });
            }
        }

        if (!deletedComment) {
            return res.status(404).json({ message: 'Comment Common not found' });
        }

        // reindex parent entity when comment is deleted
        const collectionName = deletedComment.commentType as 'notes' | 'tasks' | 'lifeEvents' | 'infoVault' | 'chatLlmThread' | 'chatLlm';
        await reindexDocument({
            reindexDocumentArr: [{
                collectionName: collectionName,
                documentId: deletedComment.entityId.toString(),
            }],
        });

        return res.json({ message: 'Comment Common deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;