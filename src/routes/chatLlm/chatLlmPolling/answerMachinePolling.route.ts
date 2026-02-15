import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import { getMongodbObjectOrNull } from '../../../utils/common/getMongodbObjectOrNull';
import { ModelAnswerMachineSubQuestion } from '../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineSubQuestions.schema';
import { ModelChatLlm } from '../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelChatLlmThread } from '../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelChatLlmAnswerMachineTokenRecord } from '../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaChatLlmAnswerMachineTokenRecord.schema';
import { ModelChatLlmAnswerMachine } from '../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaChatLlmAnswerMachine.schema';

const router = Router();

// Answer Machine Polling API
router.post(
    '/answerMachineStatus',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const auth_username = res.locals.auth_username;

            // variable -> threadId
            let threadId = getMongodbObjectOrNull(req.body.threadId);
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

            // Get all sub-questions for this thread, sorted by creation time
            const subQuestions = await ModelAnswerMachineSubQuestion.aggregate([
                {
                    $match: {
                        threadId,
                        username: auth_username,
                    },
                },
                {
                    $sort: {
                        createdAtUtc: 1,
                    },
                },
                {
                    $project: {
                        _id: 1,
                        parentMessageId: 1,
                        question: 1,
                        answer: 1,
                        status: 1,
                        errorReason: 1,
                    },
                },
            ]);

            // Count sub-questions by status
            const subQuestionsStatus = {
                pending: subQuestions.filter(sq => sq.status === 'pending').length,
                answered: subQuestions.filter(sq => sq.status === 'answered').length,
                error: subQuestions.filter(sq => sq.status === 'error').length,
                skipped: subQuestions.filter(sq => sq.status === 'skipped').length,
                total: subQuestions.length,
            };

            // Map sub-questions to include question and answer details
            const subQuestionsDetails = subQuestions.map((sq) => ({
                id: sq._id.toString(),
                question: sq.question || '',
                answer: sq.answer || '',
                status: sq.status,
                errorReason: sq.errorReason || '',
            }));

            // Build historical answer machine jobs for this thread
            const answerMachineJobs = await ModelChatLlmAnswerMachine.aggregate([
                {
                    $match: {
                        threadId,
                        username: auth_username,
                    },
                },
                {
                    $sort: {
                        createdAt: -1,
                    },
                },
                {
                    $lookup: {
                        from: 'answerMachineSubQuestion',
                        let: {
                            localParentMessageId: '$parentMessageId',
                        },
                        pipeline: [
                            {
                                $match: {
                                    threadId,
                                    username: auth_username,
                                    $expr: {
                                        $eq: ['$parentMessageId', '$$localParentMessageId'],
                                    },
                                },
                            },
                            {
                                $sort: {
                                    createdAtUtc: 1,
                                },
                            },
                            {
                                $project: {
                                    _id: 1,
                                    question: 1,
                                    answer: 1,
                                    status: 1,
                                    errorReason: 1,
                                },
                            },
                        ],
                        as: 'subQuestions',
                    },
                },
            ]);

            const answerMachineJobsDetails = answerMachineJobs.map((job) => {
                const jobSubQuestions = (job.subQuestions || []).map((sq: any) => ({
                    id: sq._id.toString(),
                    question: sq.question || '',
                    answer: sq.answer || '',
                    status: sq.status,
                    errorReason: sq.errorReason || '',
                }));

                return {
                    id: job._id.toString(),
                    parentMessageId: job.parentMessageId?.toString() || '',
                    status: job.status,
                    errorReason: job.errorReason || '',
                    finalAnswer: job.finalAnswer || '',
                    intermediateAnswers: Array.isArray(job.intermediateAnswers) ? job.intermediateAnswers : [],
                    minNumberOfIterations: job.minNumberOfIterations || 1,
                    maxNumberOfIterations: job.maxNumberOfIterations || 1,
                    currentIteration: job.currentIteration || 0,
                    subQuestions: jobSubQuestions,
                    createdAt: job.createdAt,
                    updatedAt: job.updatedAt,
                };
            });

            // Get the last user message
            const lastUserMessage = await ModelChatLlm.findOne({
                threadId,
                username: auth_username,
                isAi: false,
            }).sort({ createdAtUtc: -1 });

            // Get the last AI message
            const lastAiMessage = await ModelChatLlm.findOne({
                threadId,
                username: auth_username,
                isAi: true,
            }).sort({ createdAtUtc: -1 });

            // Check if final answer exists (AI message created after last user message)
            const hasFinalAnswer = lastUserMessage && lastAiMessage && 
                lastAiMessage.createdAtUtc > lastUserMessage.createdAtUtc;

            const lastMessageIsAi = lastAiMessage && 
                (!lastUserMessage || lastAiMessage.createdAtUtc > lastUserMessage.createdAtUtc);

            // Calculate token totals and breakdown dynamically from individual records
            const tokenSummaryPipeline = await ModelChatLlmAnswerMachineTokenRecord.aggregate([
                {
                    $match: {
                        threadId,
                    },
                },
                {
                    $group: {
                        _id: null,
                        totalPromptTokens: { $sum: { $ifNull: ['$promptTokens', 0] } },
                        totalCompletionTokens: { $sum: { $ifNull: ['$completionTokens', 0] } },
                        totalReasoningTokens: { $sum: { $ifNull: ['$reasoningTokens', 0] } },
                        totalTokens: { $sum: { $ifNull: ['$totalTokens', 0] } },
                        totalCostInUsd: { $sum: { $ifNull: ['$costInUsd', 0] } },
                    },
                },
            ]);

            const tokenByTypePipeline = await ModelChatLlmAnswerMachineTokenRecord.aggregate([
                {
                    $match: {
                        threadId,
                        queryType: { $ne: null },
                    },
                },
                {
                    $group: {
                        _id: '$queryType',
                        promptTokens: { $sum: { $ifNull: ['$promptTokens', 0] } },
                        completionTokens: { $sum: { $ifNull: ['$completionTokens', 0] } },
                        reasoningTokens: { $sum: { $ifNull: ['$reasoningTokens', 0] } },
                        totalTokens: { $sum: { $ifNull: ['$totalTokens', 0] } },
                        costInUsd: { $sum: { $ifNull: ['$costInUsd', 0] } },
                        count: { $sum: 1 },
                        maxSingleQueryTokens: { $max: { $ifNull: ['$totalTokens', 0] } },
                    },
                },
            ]);

            const tokenSummary = tokenSummaryPipeline[0] || {
                totalPromptTokens: 0,
                totalCompletionTokens: 0,
                totalReasoningTokens: 0,
                totalTokens: 0,
                totalCostInUsd: 0,
            };

            const queryTypeTokens: any = {};
            const answerMachineQueryTypes = tokenByTypePipeline.map((item) => item._id);
            tokenByTypePipeline.forEach((item) => {
                queryTypeTokens[item._id] = {
                    promptTokens: item.promptTokens || 0,
                    completionTokens: item.completionTokens || 0,
                    reasoningTokens: item.reasoningTokens || 0,
                    totalTokens: item.totalTokens || 0,
                    costInUsd: item.costInUsd || 0,
                    count: item.count || 0,
                    maxSingleQueryTokens: item.maxSingleQueryTokens || 0,
                };
            });

            // Determine overall status
            let status: 'pending' | 'answered' | 'error' | 'not_started' = 'not_started';
            let isProcessing = false;

            if (subQuestions.length === 0) {
                // No sub-questions exist - Answer Machine hasn't started or completed without sub-questions
                if (hasFinalAnswer) {
                    status = 'answered';
                    isProcessing = false;
                } else {
                    status = 'not_started';
                    isProcessing = false;
                }
            } else {
                // Sub-questions exist
                if (hasFinalAnswer) {
                    // Final answer exists - completed
                    status = 'answered';
                    isProcessing = false;
                } else if (subQuestionsStatus.pending > 0) {
                    // Still processing sub-questions
                    status = 'pending';
                    isProcessing = true;
                } else if (subQuestionsStatus.error === subQuestionsStatus.total && subQuestionsStatus.total > 0) {
                    // All sub-questions failed
                    status = 'error';
                    isProcessing = false;
                } else if (subQuestionsStatus.answered > 0 && subQuestionsStatus.pending === 0) {
                    // All sub-questions answered but final answer not yet created
                    status = 'pending';
                    isProcessing = true;
                } else {
                    // Mixed state
                    status = 'pending';
                    isProcessing = true;
                }
            }

            return res.status(200).json({
                isProcessing,
                status,
                subQuestionsStatus,
                subQuestions: subQuestionsDetails,
                hasFinalAnswer: hasFinalAnswer || false,
                lastMessageIsAi: lastMessageIsAi || false,
                // Answer Machine iteration info
                answerMachineMinNumberOfIterations: thread.answerMachineMinNumberOfIterations || 1,
                answerMachineMaxNumberOfIterations: thread.answerMachineMaxNumberOfIterations || 1,
                // Answer Machine token tracking (calculated dynamically from individual records)
                answerMachinePromptTokens: tokenSummary.totalPromptTokens || 0,
                answerMachineCompletionTokens: tokenSummary.totalCompletionTokens || 0,
                answerMachineReasoningTokens: tokenSummary.totalReasoningTokens || 0,
                answerMachineTotalTokens: tokenSummary.totalTokens || 0,
                answerMachineCostInUsd: tokenSummary.totalCostInUsd || 0,
                // Query types used (calculated dynamically)
                answerMachineQueryTypes: answerMachineQueryTypes,
                // Per-query-type token breakdown (calculated dynamically)
                answerMachineQueryTypeTokens: queryTypeTokens,
                // Historical answer machine jobs
                answerMachineJobs: answerMachineJobsDetails,
            });
        } catch (error) {
            console.error('Error in answerMachineStatus polling:', error);
            return res.status(500).json({ 
                message: 'Server error', 
                error: error instanceof Error ? error.message : 'Unknown error' 
            });
        }
    }
);

export default router;
