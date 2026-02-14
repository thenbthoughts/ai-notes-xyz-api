import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import { getMongodbObjectOrNull } from '../../../utils/common/getMongodbObjectOrNull';
import { ModelAnswerMachineSubQuestion } from '../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineSubQuestions.schema';
import { ModelChatLlm } from '../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelChatLlmThread } from '../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelChatLlmAnswerMachine } from '../../../schema/schemaChatLlm/SchemaChatLlmAnswerMachine.schema';
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

            // Get all answer machine records for this thread, sorted by creation time (most recent first)
            const allAnswerMachineRecords = await ModelChatLlmAnswerMachine.find({
                threadId,
                username: auth_username
            }).sort({ createdAtUtc: -1 });

            // Get current answer machine record data (most recent one)
            const currentAnswerMachineRecord = allAnswerMachineRecords[0];
            const currentIteration = currentAnswerMachineRecord?.currentIteration || 0;
            const answerMachineStatus = currentAnswerMachineRecord?.status || 'not_started';
            const answerMachineErrorReason = currentAnswerMachineRecord?.errorReason || '';

            // Get all sub-questions for all answer machines in this thread, grouped by answerMachineId
            const allSubQuestions = await ModelAnswerMachineSubQuestion.find({
                threadId,
                username: auth_username
            }).sort({ createdAtUtc: 1 });

            // Group sub-questions by answerMachineId
            const subQuestionsByRun = allSubQuestions.reduce((acc, sq) => {
                const runId = sq.answerMachineId?.toString() || 'legacy';
                if (!acc[runId]) {
                    acc[runId] = [];
                }
                acc[runId].push(sq);
                return acc;
            }, {} as Record<string, any[]>);

            // Get current run's sub-questions (most recent answer machine)
            const currentRunId = currentAnswerMachineRecord?._id?.toString();
            const subQuestions = currentRunId ? subQuestionsByRun[currentRunId] || [] : [];

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

            // Calculate token totals and breakdown dynamically from individual records for current run
            const tokenRecords = currentAnswerMachineRecord?._id
                ? await ModelChatLlmAnswerMachineTokenRecord.find({
                    answerMachineId: currentAnswerMachineRecord._id
                })
                : [];
            
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

            // Prepare all answer machine runs data
            const allRuns = await Promise.all(allAnswerMachineRecords.map(async (run) => {
                const runId = run._id.toString();
                const runSubQuestions = subQuestionsByRun[runId] || [];
                const runTokenRecords = await ModelChatLlmAnswerMachineTokenRecord.find({
                    answerMachineId: run._id
                });

                // Calculate token totals for this run
                let runTotalPromptTokens = 0;
                let runTotalCompletionTokens = 0;
                let runTotalReasoningTokens = 0;
                let runTotalTokens = 0;
                let runTotalCostInUsd = 0;
                const runQueryTypesSet = new Set<string>();
                const runQueryTypeTokens: any = {};

                runTokenRecords.forEach((record) => {
                    const type = record.queryType;

                    // Aggregate totals
                    runTotalPromptTokens += record.promptTokens || 0;
                    runTotalCompletionTokens += record.completionTokens || 0;
                    runTotalReasoningTokens += record.reasoningTokens || 0;
                    runTotalTokens += record.totalTokens || 0;
                    runTotalCostInUsd += record.costInUsd || 0;

                    // Track query types used
                    runQueryTypesSet.add(type);

                    // Per-query-type token breakdown
                    if (!runQueryTypeTokens[type]) {
                        runQueryTypeTokens[type] = {
                            count: 0,
                            totalTokens: 0,
                            maxSingleQueryTokens: 0,
                            promptTokens: 0,
                            completionTokens: 0,
                            reasoningTokens: 0,
                            costInUsd: 0,
                        };
                    }
                    runQueryTypeTokens[type].count += 1;
                    runQueryTypeTokens[type].totalTokens += record.totalTokens || 0;
                    runQueryTypeTokens[type].maxSingleQueryTokens = Math.max(
                        runQueryTypeTokens[type].maxSingleQueryTokens,
                        record.totalTokens || 0
                    );
                    runQueryTypeTokens[type].promptTokens += record.promptTokens || 0;
                    runQueryTypeTokens[type].completionTokens += record.completionTokens || 0;
                    runQueryTypeTokens[type].reasoningTokens += record.reasoningTokens || 0;
                    runQueryTypeTokens[type].costInUsd += record.costInUsd || 0;
                });

                // Count sub-questions by status for this run
                const runSubQuestionsStatus = {
                    pending: runSubQuestions.filter(sq => sq.status === 'pending').length,
                    answered: runSubQuestions.filter(sq => sq.status === 'answered').length,
                    error: runSubQuestions.filter(sq => sq.status === 'error').length,
                    skipped: runSubQuestions.filter(sq => sq.status === 'skipped').length,
                    total: runSubQuestions.length,
                };

                // Map sub-questions to include question and answer details for this run
                const runSubQuestionsDetails = runSubQuestions.map(sq => ({
                    id: sq._id.toString(),
                    question: sq.question || '',
                    answer: sq.answer || '',
                    status: sq.status,
                    errorReason: sq.errorReason || '',
                }));

                // Calculate status for this run based on its state
                let runStatus: 'pending' | 'answered' | 'error' | 'not_started' = 'not_started';
                if (run.finalAnswer && run.finalAnswer.trim() !== '') {
                    // Has final answer - completed successfully
                    runStatus = 'answered';
                } else if (run.errorReason && run.errorReason.trim() !== '') {
                    // Has error reason - failed
                    runStatus = 'error';
                } else if (runSubQuestions.length === 0) {
                    // No sub-questions - not started
                    runStatus = 'not_started';
                } else if (runSubQuestionsStatus.pending > 0) {
                    // Still has pending sub-questions
                    runStatus = 'pending';
                } else if (runSubQuestionsStatus.error === runSubQuestionsStatus.total && runSubQuestionsStatus.total > 0) {
                    // All sub-questions failed
                    runStatus = 'error';
                } else if (runSubQuestionsStatus.answered > 0 && runSubQuestionsStatus.pending === 0) {
                    // All sub-questions answered but no final answer yet - might be generating final answer
                    runStatus = 'pending';
                } else if (run.intermediateAnswers && run.intermediateAnswers.length > 0) {
                    // Has intermediate answers but no final answer - processing
                    runStatus = 'pending';
                } else {
                    // Mixed state or database status fallback
                    runStatus = run.status || 'pending';
                }

                return {
                    id: runId,
                    createdAtUtc: run.createdAtUtc,
                    status: runStatus,
                    errorReason: run.errorReason || '',
                    currentIteration: run.currentIteration || 0,
                    intermediateAnswers: run.intermediateAnswers || [],
                    finalAnswer: run.finalAnswer || '',
                    subQuestionsStatus: runSubQuestionsStatus,
                    subQuestions: runSubQuestionsDetails,
                    totalPromptTokens: runTotalPromptTokens,
                    totalCompletionTokens: runTotalCompletionTokens,
                    totalReasoningTokens: runTotalReasoningTokens,
                    totalTokens: runTotalTokens,
                    costInUsd: runTotalCostInUsd,
                    queryTypes: Array.from(runQueryTypesSet),
                    queryTypeTokens: runQueryTypeTokens,
                };
            }));

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
                answerMachineCurrentIteration: currentIteration,
                answerMachineStatus,
                answerMachineErrorReason,
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
                // All answer machine runs
                answerMachineRuns: allRuns,
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
