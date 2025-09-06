import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { ModelTaskSubList } from '../../schema/schemaTask/SchemaTaskSub.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import middlewareActionDatetime from '../../middleware/middlewareActionDatetime';
import { normalizeDateTimeIpAddress } from '../../utils/llm/normalizeDateTimeIpAddress';
import { llmPendingTaskTypes } from '../../utils/llmPendingTask/llmPendingTaskConstants';
import { ModelLlmPendingTaskCron } from '../../schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema';

// Router
const router = Router();

// Add Subtask API
router.post(
    '/taskSubAdd',
    middlewareUserAuth,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        try {
            const actionDatetimeObj = normalizeDateTimeIpAddress(res.locals.actionDatetime);
            console.log(actionDatetimeObj);

            const { title, parentTaskId, taskPosition } = req.body;

            const newSubtask = await ModelTaskSubList.create({
                title,
                parentTaskId: mongoose.Types.ObjectId.createFromHexString(parentTaskId), // Convert to MongoDB ObjectId
                taskPosition,
                username: res.locals.auth_username,

                ...actionDatetimeObj,
            });

            // generate embedding by id
            await ModelLlmPendingTaskCron.create({
                username: res.locals.auth_username,
                taskType: llmPendingTaskTypes.page.task.generateEmbeddingByTaskId,
                targetRecordId: mongoose.Types.ObjectId.createFromHexString(parentTaskId),
            });

            return res.status(201).json(newSubtask);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Get Subtasks API
router.post('/taskSubGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const { parentTaskId } = req.body;
        const username = res.locals.auth_username;

        const resultSubtasks = await ModelTaskSubList.aggregate([
            {
                $match: {
                    parentTaskId: mongoose.Types.ObjectId.createFromHexString(parentTaskId),
                    username
                }
            },
            {
                $sort: {
                    taskPosition: 1
                }
            }
        ]);

        return res.json({
            message: 'Subtasks retrieved successfully',
            count: resultSubtasks.length,
            docs: resultSubtasks,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Edit Subtask API
router.post(
    '/taskSubEdit',
    middlewareUserAuth,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        try {
            const actionDatetimeObj = normalizeDateTimeIpAddress(res.locals.actionDatetime);
            console.log(actionDatetimeObj);

            const {
                id,
                title,
                taskPosition,
                taskCompletedStatus,
            } = req.body;
            const auth_username = res.locals.auth_username;

            const updatedSubtask = await ModelTaskSubList.findOneAndUpdate(
                {
                    _id: mongoose.Types.ObjectId.createFromHexString(id), // Convert to MongoDB ObjectId
                    username: auth_username,
                },
                {
                    title,
                    taskPosition,
                    taskCompletedStatus,

                    // datetime ip
                    updatedAtUtc: actionDatetimeObj.updatedAtUtc,
                    updatedAtIpAddress: actionDatetimeObj.updatedAtIpAddress,
                    updatedAtUserAgent: actionDatetimeObj.updatedAtUserAgent,
                },
                {
                    new: true,
                }
            );
            if (!updatedSubtask) {
                return res.status(404).json({ message: 'Subtask not found' });
            }

            // generate embedding by id
            await ModelLlmPendingTaskCron.create({
                username: res.locals.auth_username,
                taskType: llmPendingTaskTypes.page.task.generateEmbeddingByTaskId,
                targetRecordId: updatedSubtask.parentTaskId,
            });

            return res.json(updatedSubtask);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Delete Subtask API
router.post('/taskSubDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const { id } = req.body;
        const auth_username = res.locals.auth_username;

        const deletedSubtask = await ModelTaskSubList.findOneAndDelete({
            _id: mongoose.Types.ObjectId.createFromHexString(id), // Convert to MongoDB ObjectId
            username: auth_username,
        });

        if (!deletedSubtask) {
            return res.status(404).json({ message: 'Subtask not found' });
        }
        return res.json({ message: 'Subtask deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;