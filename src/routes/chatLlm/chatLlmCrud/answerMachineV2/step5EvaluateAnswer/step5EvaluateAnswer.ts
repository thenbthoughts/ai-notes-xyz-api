import mongoose from "mongoose";
import { ModelChatLlmAnswerMachine } from "../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaChatLlmAnswerMachine.schema";
import { ModelChatLlm } from "../../../../../schema/schemaChatLlm/SchemaChatLlm.schema";
import { ModelChatLlmThread } from "../../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema";
import { ModelChatLlmAnswerMachineTokenRecord } from "../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaChatLlmAnswerMachineTokenRecord.schema";
import { getLlmConfig, LlmConfig } from "../helperFunction/answerMachineGetLlmConfig";

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

        const finalAnswer = answerMachineRecord.finalAnswer || '';

        // Evaluate the final answer
        const evaluation = evaluateFinalAnswer(finalAnswer);

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
 * Evaluate if the final answer is satisfactory
 */
const evaluateFinalAnswer = (finalAnswer: string): EvaluationResult => {
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
    let reasons: string[] = [];

    // Length check (minimum 50 characters for a meaningful answer)
    if (trimmedAnswer.length >= 50) {
        score += 30;
        reasons.push('Sufficient length');
    } else {
        reasons.push('Answer too short');
    }

    // Content diversity check (has multiple sentences)
    const sentences = trimmedAnswer.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length >= 3) {
        score += 25;
        reasons.push('Multiple sentences indicate comprehensive answer');
    } else {
        reasons.push('Answer lacks detail (few sentences)');
    }

    // Check for question-answering indicators
    const hasAnswerIndicators = /\b(because|therefore|thus|so|accordingly|consequently|as a result)\b/i.test(trimmedAnswer) ||
        /\b(I recommend|you should|consider|try|use)\b/i.test(trimmedAnswer) ||
        trimmedAnswer.includes('?') === false; // No lingering questions

    if (hasAnswerIndicators) {
        score += 25;
        reasons.push('Contains answer indicators');
    } else {
        reasons.push('Missing answer indicators');
    }

    // Check for completeness (doesn't end with "..." or similar)
    const endsIncompletely = /\.{3,}$|\.{2}$|etc\.?$|and so on\.?$/i.test(trimmedAnswer);
    if (!endsIncompletely) {
        score += 20;
        reasons.push('Answer appears complete');
    } else {
        reasons.push('Answer appears incomplete');
    }

    // Determine if satisfactory (threshold: 70% score)
    const isSatisfactory = score >= 70;
    const confidence = Math.min(score / maxScore, 1);

    return {
        isSatisfactory,
        reason: reasons.join('; '),
        confidence,
    };
};

export default step5EvaluateAnswer;