import mongoose from 'mongoose';
import { Router, Request, Response } from 'express';
import { ModelAiListGroq } from '../../schema/schemaDynamicData/SchemaGroqModel.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelLlmPendingTaskCron } from '../../schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema';
import { llmPendingTaskTypes } from '../../utils/llmPendingTask/llmPendingTaskConstants';
import llmPendingTaskProcessFunc from '../../utils/llmPendingTask/llmPendingTaskProcessFunc';

// Router
const router = Router();

// Get Model Groq API
router.get('/modelGroqGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        // pipeline
        const resultAiListGroq = await ModelAiListGroq.find({});

        if(resultAiListGroq.length === 0) {
            const task = await ModelLlmPendingTaskCron.create({
                taskType: llmPendingTaskTypes.page.settings.groqModelGet,
                username: res.locals.auth_username,

                createdAtUtc: new Date(),
            });
    
            await llmPendingTaskProcessFunc({
                _id: task._id as mongoose.Types.ObjectId,
            });

            return res.json({
                message: 'No model groq found',
                count: 0,
                docs: [],
            });
        }

        return res.json({
            message: 'Ai List Groq retrieved successfully',
            count: resultAiListGroq.length,
            docs: resultAiListGroq,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Add Model Openrouter API
router.post('/modelGroqAdd', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const task = await ModelLlmPendingTaskCron.create({
            taskType: llmPendingTaskTypes.page.settings.groqModelGet,
            username: res.locals.auth_username,

            createdAtUtc: new Date(),
        });

        await llmPendingTaskProcessFunc({
            _id: task._id as mongoose.Types.ObjectId,
        })

        return res.json({
            message: 'Model Groq added successfully',
            task,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;