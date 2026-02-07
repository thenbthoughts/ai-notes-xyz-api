import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import { getMongodbObjectOrNull } from '../../../utils/common/getMongodbObjectOrNull';
import { ModelAnswerMachineSubQuestion } from '../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineSubQuestions.schema';
import { ModelChatLlm } from '../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelChatLlmThread } from '../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelChatLlmAnswerMachineTokenRecord } from '../../../schema/schemaChatLlm/SchemaChatLlmAnswerMachineTokenRecord.schema';

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
            const subQuestions = await ModelAnswerMachineSubQuestion.find({
                threadId,
                username: auth_username,
            }).sort({ createdAtUtc: 1 });

            // Count sub-questions by status
            const subQuestionsStatus = {
                pending: subQuestions.filter(sq => sq.status === 'pending').length,
                answered: subQuestions.filter(sq => sq.status === 'answered').length,
                error: subQuestions.filter(sq => sq.status === 'error').length,
                skipped: subQuestions.filter(sq => sq.status === 'skipped').length,
                total: subQuestions.length,
            };

            // Map sub-questions to include question and answer details
            const subQuestionsDetails = subQuestions.map(sq => ({
                id: sq._id.toString(),
                question: sq.question || '',
                answer: sq.answer || '',
                status: sq.status,
                errorReason: sq.errorReason || '',
            }));

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
            const tokenRecords = await ModelChatLlmAnswerMachineTokenRecord.find({ threadId });
            
            // Calculate aggregated totals
            let totalPromptTokens = 0;
            let totalCompletionTokens = 0;
            let totalReasoningTokens = 0;
            let totalTokens = 0;
            let totalCostInUsd = 0;
            const queryTypesSet = new Set<string>();
            const queryTypeTokens: any = {};
            
            tokenRecords.forEach((record) => {
                const type = record.queryType;
                
                // Aggregate totals
                totalPromptTokens += record.promptTokens || 0;
                totalCompletionTokens += record.completionTokens || 0;
                totalReasoningTokens += record.reasoningTokens || 0;
                totalTokens += record.totalTokens || 0;
                totalCostInUsd += record.costInUsd || 0;
                
                // Track query types
                if (type) {
                    queryTypesSet.add(type);
                }
                
                // Calculate per-query-type breakdown
                if (type) {
                    if (!queryTypeTokens[type]) {
                        queryTypeTokens[type] = {
                            promptTokens: 0,
                            completionTokens: 0,
                            reasoningTokens: 0,
                            totalTokens: 0,
                            costInUsd: 0,
                            count: 0,
                            maxSingleQueryTokens: 0, // Maximum tokens from a single execution
                        };
                    }
                    queryTypeTokens[type].promptTokens += record.promptTokens || 0;
                    queryTypeTokens[type].completionTokens += record.completionTokens || 0;
                    queryTypeTokens[type].reasoningTokens += record.reasoningTokens || 0;
                    queryTypeTokens[type].totalTokens += record.totalTokens || 0;
                    queryTypeTokens[type].costInUsd += record.costInUsd || 0;
                    queryTypeTokens[type].count += 1;
                    
                    // Track maximum tokens from a single execution
                    const recordTotalTokens = record.totalTokens || 0;
                    if (recordTotalTokens > queryTypeTokens[type].maxSingleQueryTokens) {
                        queryTypeTokens[type].maxSingleQueryTokens = recordTotalTokens;
                    }
                }
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
                answerMachineCurrentIteration: thread.answerMachineCurrentIteration || 0,
                answerMachineStatus: thread.answerMachineStatus || 'not_started',
                answerMachineErrorReason: thread.answerMachineErrorReason || '',
                // Answer Machine token tracking (calculated dynamically from individual records)
                answerMachinePromptTokens: totalPromptTokens,
                answerMachineCompletionTokens: totalCompletionTokens,
                answerMachineReasoningTokens: totalReasoningTokens,
                answerMachineTotalTokens: totalTokens,
                answerMachineCostInUsd: totalCostInUsd,
                // Query types used (calculated dynamically)
                answerMachineQueryTypes: Array.from(queryTypesSet),
                // Per-query-type token breakdown (calculated dynamically)
                answerMachineQueryTypeTokens: queryTypeTokens,
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
