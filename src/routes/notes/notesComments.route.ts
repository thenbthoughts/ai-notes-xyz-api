import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { ModelNotesComments } from '../../schema/schemaNotes/SchemaNotesComments.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { normalizeDateTimeIpAddress } from '../../utils/llm/normalizeDateTimeIpAddress';
import middlewareActionDatetime from '../../middleware/middlewareActionDatetime';

// Router
const router = Router();

// Add Notes Comment API
router.post(
    '/notesCommentAdd',
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
                notesId,

                // file fields
                fileType,
                fileUrl,
                fileTitle,
                fileDescription,
            } = req.body;
            const username = res.locals.auth_username;

            const newComment = await ModelNotesComments.create({
                commentText,
                notesId: mongoose.Types.ObjectId.createFromHexString(notesId),
                username,

                // file fields
                fileType,
                fileUrl,
                fileTitle,
                fileDescription,

                // date time ip
                ...actionDatetimeObj,
            });

            return res.status(201).json(newComment);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Get Notes Comments API
router.post('/notesCommentGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const { notesId } = req.body;
        const username = res.locals.auth_username;

        const resultComments = await ModelNotesComments.find({
            notesId: mongoose.Types.ObjectId.createFromHexString(notesId),
            username,
        }).sort({ createdAtUtc: -1 });

        return res.json({
            message: 'Notes comments retrieved successfully',
            count: resultComments.length,
            docs: resultComments,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Edit Notes Comment API
router.post(
    '/notesCommentEdit',
    middlewareUserAuth,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        try {
            const actionDatetimeObj = normalizeDateTimeIpAddress(
                res.locals.actionDatetime
            );
            console.log(actionDatetimeObj);

            const { id, commentText } = req.body;
            const username = res.locals.auth_username;

            const updatedComment = await ModelNotesComments.findOneAndUpdate(
                {
                    _id: mongoose.Types.ObjectId.createFromHexString(id),
                    username,
                },
                {
                    commentText,

                    // datetime ip
                    updatedAtUtc: actionDatetimeObj.updatedAtUtc,
                    updatedAtIpAddress: actionDatetimeObj.updatedAtIpAddress,
                    updatedAtUserAgent: actionDatetimeObj.updatedAtUserAgent,
                },
                {
                    new: true,
                }
            );

            if (!updatedComment) {
                return res.status(404).json({ message: 'Notes comment not found' });
            }

            return res.json(updatedComment);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Delete Notes Comment API
router.post('/notesCommentDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const { id } = req.body;
        const username = res.locals.auth_username;

        const deletedComment = await ModelNotesComments.findOneAndDelete({
            _id: mongoose.Types.ObjectId.createFromHexString(id),
            username,
        });

        if (!deletedComment) {
            return res.status(404).json({ message: 'Notes comment not found' });
        }

        return res.json({ message: 'Notes comment deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;