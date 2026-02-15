import mongoose from "mongoose";
import { ModelChatLlmAnswerMachine } from "../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaChatLlmAnswerMachine.schema";
import { ModelChatLlm } from "../../../../../schema/schemaChatLlm/SchemaChatLlm.schema";
import { ModelChatLlmThread } from "../../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema";
import { ModelChatLlmAnswerMachineTokenRecord } from "../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaChatLlmAnswerMachineTokenRecord.schema";
import { getLlmConfig, LlmConfig } from "../helperFunction/answerMachineGetLlmConfig";
import fetchLlmUnified, { Message } from "../../../../../utils/llmPendingTask/utils/fetchLlmUnified";
import { trackAnswerMachineTokens } from "../helperFunction/tokenTracking";

interface EvaluationResult {
    isSatisfactory: boolean;
    reason: string;
    confidence: number; // 0-1 scale
}

const step5EvaluateAnswer = async ({
    answerMachineRecordId,
}: {
    answerMachineRecordId: mongoose.Types.ObjectId;
}): Promise<{
    success: boolean;
    errorReason: string;
    data: {
        isSatisfactoryFinalAnswer: boolean;
        evaluationReason: string;
    } | null;
}> => {
    try {
        console.log('step5EvaluateAnswer', answerMachineRecordId);

        // Get the answer machine record
        const answerMachineRecord = await ModelChatLlmAnswerMachine.findById(answerMachineRecordId);
        if (!answerMachineRecord) {
            return {
                success: false,
                errorReason: 'Answer machine record not found',
                data: null,
            };
        }

        const thread = await ModelChatLlmThread.findById(answerMachineRecord.threadId);
        if (!thread) {
            return {
                success: false,
                errorReason: 'Thread not found',
                data: null,
            };
        }

        // Get LLM configuration for proper token tracking
        const llmConfig = await getLlmConfig({ threadId: answerMachineRecord.threadId });
        if (!llmConfig) {
            return {
                success: false,
                errorReason: 'Failed to get LLM configuration for evaluation',
                data: null,
            };
        }

        const finalAnswer = answerMachineRecord.finalAnswer || '';

        // Evaluate the final answer using LLM
        const evaluation = await evaluateFinalAnswer(finalAnswer, llmConfig, answerMachineRecord.threadId, answerMachineRecord.username);

        // Update the answer machine record with evaluation results
        await ModelChatLlmAnswerMachine.findByIdAndUpdate(answerMachineRecordId, {
            $set: {
                isSatisfactoryFinalAnswer: evaluation.isSatisfactory,
            }
        });

        // Check if minimum iterations reached (e.g., 3 >= 3 = true)
        // Ex: Here, currentIteration = 3, minNumberOfIterations = 3
        // 1 >= 3 = false
        // 2 >= 3 = false
        // 3 >= 3 = true

        if (
            evaluation.isSatisfactory &&
            answerMachineRecord.currentIteration >= answerMachineRecord.minNumberOfIterations // minimum number of iterations reached
        ) {
            // set the status to answered
            await ModelChatLlmAnswerMachine.findByIdAndUpdate(answerMachineRecordId, {
                $set: {
                    status: 'answered',
                    finalAnswer: finalAnswer,
                }
            });

            // create a message in the thread with proper token aggregation
            await createFinalAnswerMessageWithTokens(
                finalAnswer,
                answerMachineRecord.threadId,
                answerMachineRecord.username,
                llmConfig
            );
        }

        return {
            success: true,
            errorReason: '',
            data: {
                isSatisfactoryFinalAnswer: evaluation.isSatisfactory,
                evaluationReason: evaluation.reason,
            },
        };

    } catch (error) {
        console.error(`❌ Error in step5EvaluateAnswer (answerMachineRecord ${answerMachineRecordId}):`, error);
        const errorMessage = error instanceof Error ? error.message : 'Internal server error';
        return {
            success: false,
            errorReason: errorMessage,
            data: null,
        };
    }
};

/**
 * Create final answer message in chat with proper token aggregation
 */
async function createFinalAnswerMessageWithTokens(
    finalAnswer: string,
    threadId: mongoose.Types.ObjectId,
    username: string,
    llmConfig: LlmConfig | null
): Promise<mongoose.Types.ObjectId | null> {
    try {
        if (!finalAnswer || finalAnswer.trim().length === 0) {
            return null;
        }

        // Get aggregated tokens from individual records
        const tokenRecords = await ModelChatLlmAnswerMachineTokenRecord.find({ threadId: threadId });

        let finalTokens = {
            promptTokens: 0,
            completionTokens: 0,
            reasoningTokens: 0,
            totalTokens: 0,
            costInUsd: 0,
        };

        tokenRecords.forEach((record) => {
            finalTokens.promptTokens += record.promptTokens || 0;
            finalTokens.completionTokens += record.completionTokens || 0;
            finalTokens.reasoningTokens += record.reasoningTokens || 0;
            finalTokens.totalTokens += record.totalTokens || 0;
            finalTokens.costInUsd += record.costInUsd || 0;
        });

        const newMessage = await ModelChatLlm.create({
            type: 'text',
            content: finalAnswer,
            username: username,
            threadId: threadId,
            isAi: true,
            aiModelProvider: llmConfig?.provider || '',
            aiModelName: llmConfig?.model || '',
            // Token stats - aggregated from all answer machine operations
            promptTokens: finalTokens.promptTokens || 0,
            completionTokens: finalTokens.completionTokens || 0,
            reasoningTokens: finalTokens.reasoningTokens || 0,
            totalTokens: finalTokens.totalTokens || 0,
            costInUsd: finalTokens.costInUsd || 0,
            createdAtUtc: new Date(),
            updatedAtUtc: new Date(),
        });

        return newMessage._id as mongoose.Types.ObjectId;
    } catch (error) {
        console.error('Error in createFinalAnswerMessageWithTokens:', error);
        return null;
    }
}

/**
 * Evaluate if the final answer is satisfactory using LLM
 */
const evaluateFinalAnswer = async (
    finalAnswer: string,
    llmConfig: LlmConfig,
    threadId: mongoose.Types.ObjectId,
    username: string
): Promise<EvaluationResult> => {
    if (!finalAnswer || finalAnswer.trim().length === 0) {
        return {
            isSatisfactory: false,
            reason: 'Final answer is empty',
            confidence: 0,
        };
    }

    try {
        // Create evaluation prompt
        const evaluationPrompt = `You are an expert evaluator. Evaluate the following answer for quality, completeness, and accuracy.

Answer to evaluate:
${finalAnswer}

Please evaluate this answer on the following criteria:
1. Completeness - Does it fully answer the question?
2. Accuracy - Is the information correct and well-founded?
3. Clarity - Is it clearly written and easy to understand?
4. Relevance - Does it stay on topic and provide relevant information?

Respond with a JSON object in this exact format:
{
  "isSatisfactory": boolean (true if the answer meets quality standards, false otherwise),
  "confidence": number (0.0 to 1.0 - how confident you are in your evaluation),
  "reason": "string (brief explanation of your evaluation, max 100 characters)"
}

Be strict but fair in your evaluation. Only mark as satisfactory if the answer is truly comprehensive and accurate.`;

        const messages: Message[] = [
            {
                role: 'system',
                content: 'You are an expert evaluator. Always respond with valid JSON in the specified format.',
            },
            {
                role: 'user',
                content: evaluationPrompt,
            },
        ];

        // Call LLM for evaluation
        const llmResult = await fetchLlmUnified({
            provider: llmConfig.provider,
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: llmConfig.model,
            messages,
            temperature: 0.1, // Low temperature for consistent evaluation
            maxTokens: 200,
            responseFormat: 'json_object',
            headersExtra: llmConfig.customHeaders,
        });

        if (!llmResult.success || !llmResult.content) {
            console.warn('[Evaluation] LLM evaluation failed, falling back to basic check');
            // Fallback to basic programmatic evaluation
            return fallbackEvaluation(finalAnswer);
        }

        // Track tokens for evaluation
        try {
            await trackAnswerMachineTokens(
                threadId,
                llmResult.usageStats,
                username,
                'evaluation'
            );
        } catch (tokenError) {
            console.warn('[Evaluation] Failed to track tokens:', tokenError);
        }

        // Parse LLM evaluation result
        try {
            const parsed = JSON.parse(llmResult.content);

            // Validate the response structure
            if (typeof parsed.isSatisfactory === 'boolean' &&
                typeof parsed.confidence === 'number' &&
                typeof parsed.reason === 'string') {

                return {
                    isSatisfactory: parsed.isSatisfactory,
                    confidence: Math.max(0, Math.min(1, parsed.confidence)), // Clamp to 0-1
                    reason: parsed.reason.substring(0, 100), // Limit reason length
                };
            } else {
                console.warn('[Evaluation] Invalid LLM response structure, falling back to basic check');
                return fallbackEvaluation(finalAnswer);
            }
        } catch (parseError) {
            console.warn('[Evaluation] Failed to parse LLM response, falling back to basic check:', parseError);
            return fallbackEvaluation(finalAnswer);
        }

    } catch (error) {
        console.error('[Evaluation] Error during LLM evaluation:', error);
        // Fallback to basic programmatic evaluation
        return fallbackEvaluation(finalAnswer);
    }
};

/**
 * Fallback evaluation when LLM evaluation fails
 */
const fallbackEvaluation = (finalAnswer: string): EvaluationResult => {
    if (!finalAnswer || finalAnswer.trim().length === 0) {
        return {
            isSatisfactory: false,
            reason: 'Final answer is empty',
            confidence: 0,
        };
    }

    const trimmedAnswer = finalAnswer.trim();
    let score = 0;
    const maxScore = 100;

    // Basic quality checks
    if (trimmedAnswer.length >= 50) score += 40; // Length
    if (trimmedAnswer.split(/[.!?]+/).length >= 3) score += 30; // Multiple sentences
    if (!trimmedAnswer.includes('?')) score += 30; // No lingering questions

    const isSatisfactory = score >= 70;
    const confidence = Math.min(score / maxScore, 1);

    return {
        isSatisfactory,
        reason: `Fallback evaluation: ${isSatisfactory ? 'Passed' : 'Failed'} basic quality checks`,
        confidence,
    };
};

export default step5EvaluateAnswer;