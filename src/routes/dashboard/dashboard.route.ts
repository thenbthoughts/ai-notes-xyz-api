import { Router, Request, Response } from 'express';
import { ModelTask } from '../../schema/schemaTask/SchemaTask.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';

// Router
const router = Router();

// get dashboard stats
router.get(
    '/get-dashboard-stats',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const auth_username = res.locals.auth_username;

            const resultTasks = await ModelTask.aggregate([
                {
                    $match: {
                        username: auth_username,
                    }
                },
                {
                    $count: 'totalTasks',
                }
            ]);

            const resultTasksRemaining = await ModelTask.aggregate([
                {
                    $match: {
                        username: auth_username,
                        isCompleted: false,
                        isArchived: false,
                    }
                },
                {
                    $count: 'taskRemainingCount',
                }
            ]);

            let totalCount = 0;
            if (resultTasks.length === 1) {
                if (resultTasks[0].totalTasks) {
                    totalCount = resultTasks[0].totalTasks;
                }
            }

            let taskRemainingCount = 0;
            if (resultTasksRemaining.length === 1) {
                if (resultTasksRemaining[0].taskRemainingCount) {
                    taskRemainingCount = resultTasksRemaining[0].taskRemainingCount;
                }
            }

            let taskCompletedCount = totalCount - taskRemainingCount;

            return res.json({
                message: 'Tasks retrieved successfully',
                docs: {
                    taskRemainingCount,
                    taskCompletedCount,
                    totalCount,
                },
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

export default router;