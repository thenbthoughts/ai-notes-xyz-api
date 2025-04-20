import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';
import { ModelTask } from '../../schema/SchemaTask.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { normalizeDateTimeIpAddress } from '../../utils/llm/normalizeDateTimeIpAddress';
import middlewareActionDatetime from '../../middleware/middlewareActionDatetime';

// Router
const router = Router();

// taskAdd
router.post(
    '/taskAdd',
    middlewareUserAuth,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        try {
            const { title, description } = req.body;

            const actionDatetimeObj = normalizeDateTimeIpAddress(
                res.locals.actionDatetime
            );
            console.log(actionDatetimeObj);

            const newTask = await ModelTask.create({
                // 
                title,
                description,
                priority: '',
                dueDate: null,

                // current
                taskStatus: 'Todo',

                // auth
                username: res.locals.auth_username,

                // tagsAutoAi
                tagsAutoAi: ['To Do'],

                // date time ip
                ...actionDatetimeObj,
            });

            return res.status(201).json(newTask);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// taskGet
router.post(
    '/taskGet',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            let recordId = '';
            if (req.body?.recordId) {
                if (typeof req.body?.recordId === 'string') {
                    if (req.body?.recordId.trim() !== '') {
                        recordId = req.body?.recordId;
                    }
                }
            }

            let tempStage = {} as PipelineStage;
            const stateDocument = [] as PipelineStage[];

            // stateDocument -> match
            const tempStageMatch = {
                username: res.locals.auth_username,
            } as {
                username: string;
                title?: RegExp;
                description?: RegExp;
                paginationDateLocalYearMonthStr?: string;
            };
            tempStage = {
                $match: {
                    ...tempStageMatch,
                }
            }
            stateDocument.push(tempStage);

            // stage -> match record id
            if (recordId.trim() !== '') {
                tempStage = {
                    $match: {
                        _id: new mongoose.Types.ObjectId(recordId),
                    }
                };
                stateDocument.push(tempStage);
            }

            // stateDocument -> sort
            tempStage = {
                $sort: {
                    dateTimeUtc: 1,
                }
            }
            stateDocument.push(tempStage);

            // pipeline
            const resultTasks = await ModelTask.aggregate(stateDocument);

            return res.json({
                message: 'Tasks retrieved successfully',
                count: resultTasks.length,
                docs: resultTasks,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// taskEdit
router.post(
    '/taskEdit',
    middlewareUserAuth,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        try {
            const auth_username = res.locals.auth_username;

            const actionDatetimeObj = normalizeDateTimeIpAddress(
                res.locals.actionDatetime
            );
            console.log(actionDatetimeObj);

            const { id, title, description, taskStatus, labels } = req.body;
            const updatedTask = await ModelTask.findOneAndUpdate(
                {
                    _id: id,
                    username: auth_username,
                },
                {
                    title,
                    description,
                    taskStatus,
                    labels,

                    // datetime ip
                    updatedAtUtc: actionDatetimeObj.updatedAtUtc,
                    updatedAtIpAddress: actionDatetimeObj.updatedAtIpAddress,
                    updatedAtUserAgent: actionDatetimeObj.updatedAtUserAgent,
                },
                {
                    new: true,
                }
            );
            if (!updatedTask) {
                return res.status(404).json({ message: 'Task not found' });
            }
            return res.json(updatedTask);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// taskDelete
router.post('/taskDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const {
            id
        } = req.body;
        const auth_username = res.locals.auth_username;

        const deletedTask = await ModelTask.findOneAndDelete({
            _id: id,
            username: auth_username,
        });
        if (!deletedTask) {
            return res.status(404).json({ message: 'Task not found' });
        }
        // TODO delete task comments
        // TODO delete task list
        return res.json({ message: 'Task deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;