import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { ModelTaskComments } from '../../schema/schemaTask/SchemaTaskComments.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { normalizeDateTimeIpAddress } from '../../utils/llm/normalizeDateTimeIpAddress';
import middlewareActionDatetime from '../../middleware/middlewareActionDatetime';
import { llmPendingTaskTypes } from '../../utils/llmPendingTask/llmPendingTaskConstants';
import { ModelLlmPendingTaskCron } from '../../schema/SchemaLlmPendingTaskCron.schema';

// Router
const router = Router();

// Add Task Comment API
router.post(
    '/taskCommentAdd',
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
                taskId,

                // file fields
                fileType,
                fileUrl,
                fileTitle,
                fileDescription,
            } = req.body;
            const username = res.locals.auth_username;

            const newComment = await ModelTaskComments.create({
                commentText,
                taskId: mongoose.Types.ObjectId.createFromHexString(taskId),
                username,

                // file fields
                fileType,
                fileUrl,
                fileTitle,
                fileDescription,

                // date time ip
                ...actionDatetimeObj,
            });

            // generate embedding by id
            await ModelLlmPendingTaskCron.create({
                username: res.locals.auth_username,
                taskType: llmPendingTaskTypes.page.task.generateEmbeddingByTaskId,
                targetRecordId: mongoose.Types.ObjectId.createFromHexString(taskId),
            });

            return res.status(201).json(newComment);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Get Task Comments API
router.post('/taskCommentGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const { taskId } = req.body;
        const username = res.locals.auth_username;

        const resultComments = await ModelTaskComments.find({
            taskId: mongoose.Types.ObjectId.createFromHexString(taskId),
            username,
        }).sort({ createdAtUtc: -1 });

        return res.json({
            message: 'Task comments retrieved successfully',
            count: resultComments.length,
            docs: resultComments,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Edit Task Comment API
router.post(
    '/taskCommentEdit',
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

            const updatedComment = await ModelTaskComments.findOneAndUpdate(
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
                return res.status(404).json({ message: 'Task comment not found' });
            }

            // generate embedding by id
            await ModelLlmPendingTaskCron.create({
                username: res.locals.auth_username,
                taskType: llmPendingTaskTypes.page.task.generateEmbeddingByTaskId,
                targetRecordId: updatedComment.taskId,
            });

            return res.json(updatedComment);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Delete Task Comment API
router.post('/taskCommentDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const { id } = req.body;
        const username = res.locals.auth_username;

        const deletedComment = await ModelTaskComments.findOneAndDelete({
            _id: mongoose.Types.ObjectId.createFromHexString(id),
            username,
        });

        if (!deletedComment) {
            return res.status(404).json({ message: 'Task comment not found' });
        }

        // generate embedding by id
        await ModelLlmPendingTaskCron.create({
            username: res.locals.auth_username,
            taskType: llmPendingTaskTypes.page.task.generateEmbeddingByTaskId,
            targetRecordId: deletedComment.taskId,
        });

        return res.json({ message: 'Task comment deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;