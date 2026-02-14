import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { getMongodbObjectOrNull } from '../../utils/common/getMongodbObjectOrNull';
import { ModelChatLlmThread } from '../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelChatLlmAnswerMachineStats } from '../../schema/schemaChatLlm/SchemaChatLlmAnswerMachineStats.schema';

const router = Router();

// Get Answer Machine Stats by Thread ID
router.get(
    '/answerMachineStats',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const auth_username = res.locals.auth_username;

            // Get threadId from query params
            let threadId = getMongodbObjectOrNull(req.query.threadId as string);
            if (threadId === null) {
                return res.status(400).json({ message: 'Thread ID cannot be null' });
            }

            // Get thread to verify ownership
            const thread = await ModelChatLlmThread.findOne({
                _id: threadId,
                username: auth_username,
            });

            if (!thread) {
                return res.status(404).json({ message: 'Thread not found' });
            }

            // Get all completed Answer Machine stats for this thread, sorted by creation time (most recent first)
            const statsRecords = await ModelChatLlmAnswerMachineStats.find({
                threadId,
                username: auth_username,
            }).sort({ createdAtUtc: -1 });

            // Transform the data for frontend consumption
            const formattedStats = statsRecords.map(stat => ({
                id: stat._id.toString(),
                answerMachineId: stat.answerMachineId.toString(),
                parentMessageId: stat.parentMessageId?.toString(),
                createdAt: stat.createdAtUtc,
                subQuestionsCount: stat.subQuestionsCount,
                intermediateAnswersCount: stat.intermediateAnswersCount,
                finalAnswer: stat.finalAnswer,
                totalTokens: stat.totalTokens,
                costInUsd: stat.costInUsd,
                status: stat.status,
                tokenBreakdown: stat.tokenBreakdown,
            }));

            return res.status(200).json({
                success: true,
                data: formattedStats,
            });
        } catch (error) {
            console.error('Error fetching Answer Machine stats:', error);
            return res.status(500).json({
                message: 'Server error',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
);

export default router;