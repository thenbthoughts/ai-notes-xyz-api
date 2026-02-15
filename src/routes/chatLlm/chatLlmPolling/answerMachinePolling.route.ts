import { Router, Request, Response } from 'express';
import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import { getMongodbObjectOrNull } from '../../../utils/common/getMongodbObjectOrNull';
import { ModelAnswerMachineSubQuestion } from '../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineSubQuestions.schema';
import { ModelChatLlm } from '../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelChatLlmThread } from '../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelChatLlmAnswerMachineTokenRecord } from '../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaChatLlmAnswerMachineTokenRecord.schema';
import { ModelChatLlmAnswerMachine } from '../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaChatLlmAnswerMachine.schema';

const router = Router();

/** Plain object for frontend display */
export interface AnswerMachinePollingResponse {
    isProcessing: boolean;
    status: 'pending' | 'answered' | 'error' | 'not_started';
    jobs: Array<{
        id: string;
        status: string;
        currentIteration: number;
        maxNumberOfIterations: number;
        subQuestions: Array<{
            id: string;
            question: string;
            answer: string;
            status: string;
        }>;
    }>;
    tokenUsage: {
        total: number;
        prompt: number;
        completion: number;
        reasoning: number;
        costInUsd: number;
    };
    perQueryType: Record<string, {
        totalTokens: number;
        maxTokensPerQuery: number;
        count: number;
    }>;
}

router.post(
    '/answerMachineStatus',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const auth_username = res.locals.auth_username;
            const threadId = getMongodbObjectOrNull(req.body.threadId);
            if (threadId === null) {
                return res.status(400).json({ message: 'Thread ID cannot be null' });
            }

            const thread = await ModelChatLlmThread.findOne({
                _id: threadId,
                username: auth_username,
            });
            if (!thread) {
                return res.status(404).json({ message: 'Thread not found' });
            }

            const latestAnswerMachineRecord = await ModelChatLlmAnswerMachine.findOne({
                threadId,
                username: auth_username,
            }).sort({ createdAt: -1 });

            if (!latestAnswerMachineRecord) {
                return res.status(200).json({
                    isProcessing: false,
                    status: 'not_started',
                    jobs: [],
                    tokenUsage: { total: 0, prompt: 0, completion: 0, reasoning: 0, costInUsd: 0 },
                    perQueryType: {},
                } as AnswerMachinePollingResponse);
            }

            const subQuestions = await ModelAnswerMachineSubQuestion.find({
                answerMachineRecordId: latestAnswerMachineRecord._id,
            }).sort({ createdAtUtc: 1 });

            const subQuestionsStatus = {
                pending: subQuestions.filter(sq => sq.status === 'pending').length,
                answered: subQuestions.filter(sq => sq.status === 'answered').length,
                error: subQuestions.filter(sq => sq.status === 'error').length,
                total: subQuestions.length,
            };

            const lastUserMessage = await ModelChatLlm.findOne({
                threadId,
                username: auth_username,
                isAi: false,
            }).sort({ createdAtUtc: -1 });
            const lastAiMessage = await ModelChatLlm.findOne({
                threadId,
                username: auth_username,
                isAi: true,
            }).sort({ createdAtUtc: -1 });
            const hasFinalAnswer = !!(lastUserMessage && lastAiMessage && lastAiMessage.createdAtUtc > lastUserMessage.createdAtUtc);

            let status: 'pending' | 'answered' | 'error' | 'not_started' = 'not_started';
            let isProcessing = false;
            if (subQuestions.length === 0) {
                status = hasFinalAnswer ? 'answered' : 'not_started';
            } else {
                if (hasFinalAnswer) {
                    status = 'answered';
                } else if (subQuestionsStatus.pending > 0 || (subQuestionsStatus.answered > 0 && subQuestionsStatus.pending === 0)) {
                    status = 'pending';
                    isProcessing = true;
                } else if (subQuestionsStatus.error === subQuestionsStatus.total) {
                    status = 'error';
                } else {
                    status = 'pending';
                    isProcessing = true;
                }
            }

            const answerMachineJobs = await ModelChatLlmAnswerMachine.aggregate([
                { $match: { threadId, username: auth_username } },
                { $sort: { createdAt: -1 } },
                {
                    $lookup: {
                        from: 'answerMachineSubQuestion',
                        let: { localAnswerMachineRecordId: '$_id' },
                        pipeline: [
                            { $match: { $expr: { $eq: ['$answerMachineRecordId', '$$localAnswerMachineRecordId'] } } },
                            { $sort: { createdAtUtc: 1 } },
                            { $project: { _id: 1, question: 1, answer: 1, status: 1 } },
                        ],
                        as: 'subQuestions',
                    },
                },
            ]);

            const jobs = answerMachineJobs.map((job) => ({
                id: job._id.toString(),
                status: job.status || 'pending',
                currentIteration: job.currentIteration || 0,
                maxNumberOfIterations: job.maxNumberOfIterations || 1,
                subQuestions: (job.subQuestions || []).map((sq: any) => ({
                    id: sq._id.toString(),
                    question: sq.question || '',
                    answer: sq.answer || '',
                    status: sq.status || 'pending',
                })),
            }));

            const [tokenSummary] = await ModelChatLlmAnswerMachineTokenRecord.aggregate([
                { $match: { threadId } },
                {
                    $group: {
                        _id: null,
                        total: { $sum: { $ifNull: ['$totalTokens', 0] } },
                        prompt: { $sum: { $ifNull: ['$promptTokens', 0] } },
                        completion: { $sum: { $ifNull: ['$completionTokens', 0] } },
                        reasoning: { $sum: { $ifNull: ['$reasoningTokens', 0] } },
                        costInUsd: { $sum: { $ifNull: ['$costInUsd', 0] } },
                    },
                },
            ]);

            const tokenByType = await ModelChatLlmAnswerMachineTokenRecord.aggregate([
                { $match: { threadId, queryType: { $ne: null } } },
                {
                    $group: {
                        _id: '$queryType',
                        totalTokens: { $sum: { $ifNull: ['$totalTokens', 0] } },
                        maxTokensPerQuery: { $max: { $ifNull: ['$totalTokens', 0] } },
                        count: { $sum: 1 },
                    },
                },
            ]);

            const perQueryType: Record<string, { totalTokens: number; maxTokensPerQuery: number; count: number }> = {};
            tokenByType.forEach((item) => {
                perQueryType[item._id] = {
                    totalTokens: item.totalTokens || 0,
                    maxTokensPerQuery: item.maxTokensPerQuery || 0,
                    count: item.count || 0,
                };
            });

            const response: AnswerMachinePollingResponse = {
                isProcessing,
                status,
                jobs,
                tokenUsage: {
                    total: tokenSummary?.total ?? 0,
                    prompt: tokenSummary?.prompt ?? 0,
                    completion: tokenSummary?.completion ?? 0,
                    reasoning: tokenSummary?.reasoning ?? 0,
                    costInUsd: tokenSummary?.costInUsd ?? 0,
                },
                perQueryType,
            };

            return res.status(200).json(response);
        } catch (error) {
            console.error('Error in answerMachineStatus polling:', error);
            return res.status(500).json({
                message: 'Server error',
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }
);

export default router;
