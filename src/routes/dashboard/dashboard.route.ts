import { Router, Request, Response } from 'express';
import { ModelTask } from '../../schema/schemaTask/SchemaTask.schema';
import { ModelUserApiKey } from '../../schema/schemaUser/SchemaUserApiKey.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';

// Router
const router = Router();

router.get(
    '/test-connection',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const auth_userId = res.locals.auth_userId;
            const started = Date.now();
            const doc = await ModelUserApiKey.findOne({ userId: auth_userId }).lean();
            const latency = Date.now() - started;
            if (!doc) {
                return res.json({ message: 'No keys', latencyMs: latency, valid: {} });
            }
            return res.json({
                message: 'Connection ok',
                latencyMs: latency,
                valid: {
                    apiKeyGroqValid: !!doc.apiKeyGroqValid,
                    apiKeyOpenrouterValid: !!doc.apiKeyOpenrouterValid,
                    apiKeyS3Valid: !!doc.apiKeyS3Valid,
                    apiKeyOllamaValid: !!doc.apiKeyOllamaValid,
                    apiKeyQdrantValid: !!doc.apiKeyQdrantValid,
                    smtpValid: !!doc.smtpValid,
                    telegramValid: !!doc.telegramValid,
                    apiKeyReplicateValid: !!doc.apiKeyReplicateValid,
                    apiKeyRunpodValid: !!doc.apiKeyRunpodValid,
                    apiKeyOpenaiValid: !!doc.apiKeyOpenaiValid,
                    apiKeyLocalaiValid: !!doc.apiKeyLocalaiValid,
                    agentWorkspaceValid: !!doc.agentWorkspaceValid,
                    mcpBearerTokenValid: !!doc.mcpBearerTokenValid,
                },
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// get dashboard stats
router.get(
    '/get-dashboard-stats',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const auth_userId = res.locals.auth_userId;

            const resultTasks = await ModelTask.aggregate([
                {
                    $match: {
                        userId: auth_userId,
                    }
                },
                {
                    $count: 'totalTasks',
                }
            ]);

            const resultTasksRemaining = await ModelTask.aggregate([
                {
                    $match: {
                        userId: auth_userId,
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