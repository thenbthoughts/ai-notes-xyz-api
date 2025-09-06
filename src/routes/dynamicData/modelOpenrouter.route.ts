import mongoose from 'mongoose';
import { Router, Request, Response } from 'express';
import { ModelAiListOpenrouter } from '../../schema/schemaDynamicData/SchemaOpenrouterModel.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelLlmPendingTaskCron } from '../../schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema';
import { llmPendingTaskTypes } from '../../utils/llmPendingTask/llmPendingTaskConstants';
import llmPendingTaskProcessFunc from '../../utils/llmPendingTask/llmPendingTaskProcessFunc';

// Router
const router = Router();

// Get Model Openrouter API
router.get('/modelOpenrouterGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        // pipeline
        const resultAiListOpenrouter = await ModelAiListOpenrouter.find({});

        if(resultAiListOpenrouter.length === 0) {
            const task = await ModelLlmPendingTaskCron.create({
                taskType: llmPendingTaskTypes.page.settings.openRouterModelGet,
                username: res.locals.auth_username,
            });
    
            await llmPendingTaskProcessFunc({
                _id: task._id as mongoose.Types.ObjectId,
            });

            return res.json({
                message: 'No model openrouter found',
                count: 0,
                docs: [],
            });
        }

        return res.json({
            message: 'Ai List Openrouter retrieved successfully',
            count: resultAiListOpenrouter.length,
            docs: resultAiListOpenrouter,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Add Model Openrouter API
router.post('/modelOpenrouterAdd', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const task = await ModelLlmPendingTaskCron.create({
            taskType: llmPendingTaskTypes.page.settings.openRouterModelGet,
            username: res.locals.auth_username,
        });

        await llmPendingTaskProcessFunc({
            _id: task._id as mongoose.Types.ObjectId,
        })

        return res.json({
            message: 'Model Openrouter added successfully',
            task,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;