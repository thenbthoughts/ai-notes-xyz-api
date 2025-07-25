import { Router, Request, Response } from 'express';
import { ModelLlmPendingTaskCron } from '../../schema/SchemaLlmPendingTaskCron.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import llmPendingTaskProcessFunc from '../../utils/llmPendingTask/llmPendingTaskProcessFunc';

// Router
const router = Router();

// Get Note API
router.post('/processBackgroundTask', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const auth_username = res.locals.auth_username;

        const results = await ModelLlmPendingTaskCron.aggregate([
            {
                $match: {
                    username: auth_username,
                    taskStatus: 'pending',
                }
            },
            {
                $sample: {
                    size: 1
                }
            }
        ]);

        if(results.length === 0) {
            return res.status(400).json({
                success: '',
                error: 'No task is pending',
            });
        }

        if(results.length === 1) {
            const result = await llmPendingTaskProcessFunc({
                _id: results[0]._id
            });
            console.log(result);
        }

        return res.json({
            success: 'Done',
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;