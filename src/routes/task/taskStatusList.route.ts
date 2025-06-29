import { Router, Request, Response } from 'express';
import { ModelTaskStatusList } from '../../schema/schemaTask/SchemaTaskStatusList.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import mongoose from 'mongoose';
import { ModelTaskWorkspace } from '../../schema/schemaTask/SchemaTaskWorkspace.schema';

// Router
const router = Router();

// Add Task Board List API
router.post('/taskStatusListAdd', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const auth_username = res.locals.auth_username;
        const { statusTitle, listPosition, taskWorkspaceId } = req.body;

        // task workspace id
        let taskWorkspaceIdObj = null as mongoose.Types.ObjectId | null;
        if (taskWorkspaceId) {
            let tempTaskWorkspaceIdObj = mongoose.Types.ObjectId.createFromHexString(taskWorkspaceId);
            if (tempTaskWorkspaceIdObj) {
                const workspace = await ModelTaskWorkspace.findOne({
                    _id: tempTaskWorkspaceIdObj,
                    username: auth_username,
                });
                if (!workspace) {
                    return res.status(400).json({ message: 'Task workspace not found or unauthorized' });
                }
                taskWorkspaceIdObj = workspace._id as mongoose.Types.ObjectId;
            }
        }

        const newTaskStatusList = await ModelTaskStatusList.create({
            // fields
            statusTitle,
            listPosition,

            // task workspace id
            taskWorkspaceId: taskWorkspaceIdObj,

            // auth
            username: auth_username,
        });

        await revalidatePositionAll({
            auth_username,
        });

        return res.status(201).json(newTaskStatusList);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Get Task Board List API
router.post('/taskStatusListGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const username = res.locals.auth_username;
        const { taskWorkspaceId } = req.body;

        // task workspace id
        let taskWorkspaceIdObj = null as mongoose.Types.ObjectId | null;
        if (taskWorkspaceId) {
            let tempTaskWorkspaceIdObj = mongoose.Types.ObjectId.createFromHexString(taskWorkspaceId);
            if (tempTaskWorkspaceIdObj) {
                const workspace = await ModelTaskWorkspace.findOne({
                    _id: tempTaskWorkspaceIdObj,
                    username: username,
                });
                if (!workspace) {
                    return res.status(400).json({ message: 'Task workspace not found or unauthorized' });
                }
                taskWorkspaceIdObj = workspace._id as mongoose.Types.ObjectId;
            }
        }

        const resultTaskStatusLists = await ModelTaskStatusList.find({
            username,
            taskWorkspaceId: taskWorkspaceIdObj,
        }).sort({ listPosition: 1 });

        return res.json({
            message: 'Task status list retrieved successfully',
            count: resultTaskStatusLists.length,
            docs: resultTaskStatusLists,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Edit Task Board List API
router.post('/taskStatusListEdit', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const { id, statusTitle, listPosition, taskWorkspaceId } = req.body;
        const auth_username = res.locals.auth_username;

        // task workspace id
        let taskWorkspaceIdObj = null as mongoose.Types.ObjectId | null;
        if (taskWorkspaceId) {
            let tempTaskWorkspaceIdObj = mongoose.Types.ObjectId.createFromHexString(taskWorkspaceId);
            if (tempTaskWorkspaceIdObj) {
                const workspace = await ModelTaskWorkspace.findOne({
                    _id: tempTaskWorkspaceIdObj,
                    username: auth_username,
                });
                if (!workspace) {
                    return res.status(400).json({ message: 'Task workspace not found or unauthorized' });
                }
                taskWorkspaceIdObj = workspace._id as mongoose.Types.ObjectId;
            }
        }

        const updatedTaskStatusList = await ModelTaskStatusList.findOneAndUpdate(
            {
                _id: id,
                username: auth_username,
            },
            {
                statusTitle,
                listPosition,

                // task workspace id
                taskWorkspaceId: taskWorkspaceIdObj,
            },
            {
                new: true,
            }
        );
        if (!updatedTaskStatusList) {
            return res.status(404).json({ message: 'Task status list not found' });
        }

        await revalidatePositionAll({
            auth_username,
        });

        return res.json(updatedTaskStatusList);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Delete Task Board List API
router.post('/taskStatusListDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const { id } = req.body;
        const auth_username = res.locals.auth_username;

        const deletedTaskStatusList = await ModelTaskStatusList.findOneAndDelete({
            _id: id,
            username: auth_username,
        });
        if (!deletedTaskStatusList) {
            return res.status(404).json({ message: 'Task status list not found' });
        }

        await revalidatePositionAll({
            auth_username,
        });

        return res.json({ message: 'Task board list deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

const revalidatePositionAll = async ({
    auth_username
}: {
    auth_username: string;
}) => {
    try {
        const result = await ModelTaskStatusList.aggregate([
            {
                $match: {
                    username: auth_username,
                }
            },
            {
                $sort: {
                    listPosition: 1,
                }
            },
        ]);

        for (let index = 0; index < result.length; index++) {
            const element = result[index];
            if (element.listPosition !== index + 1) {
                await ModelTaskStatusList.findByIdAndUpdate(
                    element._id,
                    { listPosition: index + 1 }, // Update the listPosition
                    { new: true } // Return the updated document
                );
            }
        }
    } catch (error) {
        console.error(error);
    }
};

// Task Status List Revalidate Position by ID API
router.post('/taskStatusListRevalidatePositionById', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const { _id, upOrDown } = req.body;
        const auth_username = res.locals.auth_username;

        const taskStatusList = await ModelTaskStatusList.findById(_id);
        if (!taskStatusList) {
            return res.status(400).json({ message: 'Task status list not found' });
        }

        const currentPosition = taskStatusList.listPosition;
        const newPosition = upOrDown === 'up' ? currentPosition - 1 : currentPosition + 1;

        const targetTaskStatusList = await ModelTaskStatusList.findOne({ listPosition: newPosition });
        if (targetTaskStatusList) {
            await ModelTaskStatusList.findByIdAndUpdate(
                targetTaskStatusList._id,
                { listPosition: currentPosition },
                { new: true }
            );
        }

        await ModelTaskStatusList.findByIdAndUpdate(
            _id,
            { listPosition: newPosition },
            { new: true }
        );

        await revalidatePositionAll({
            auth_username,
        });

        return res.json({ message: `Task status list moved ${upOrDown} successfully` });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;