import mongoose from "mongoose";
import { ModelChatLlmAnswerMachine } from "../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaChatLlmAnswerMachine.schema";
import { ModelChatLlm } from "../../../../../schema/schemaChatLlm/SchemaChatLlm.schema";
import { ModelChatLlmThread } from "../../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema";

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

        const finalAnswer = answerMachineRecord.finalAnswer || '';

        // Evaluate the final answer
        const evaluation = evaluateFinalAnswer(finalAnswer);

        // Check if minimum iterations reached (e.g., 3 >= 3 = true)
        // Ex: Here, currentIteration = 3, minNumberOfIterations = 3
        // 1 >= 3 = false
        // 2 >= 3 = false
        // 3 >= 3 = true

        if (
            evaluation.isSatisfactory &&
            answerMachineRecord.currentIteration >= answerMachineRecord.minNumberOfIterations // minimum number of iterations reached
        ) {
            // set the isSatisfactoryFinalAnswer to true
            await ModelChatLlmAnswerMachine.findByIdAndUpdate(answerMachineRecordId, {
                $set: {
                    isSatisfactoryFinalAnswer: true,
                    finalAnswer: finalAnswer,
                }
            });

            // create a message in the thread
            await ModelChatLlm.create({
                type: 'text',
                content: finalAnswer,
                username: answerMachineRecord.username,
                threadId: answerMachineRecord.threadId,
                isAi: true,
                aiModelProvider: thread.aiModelProvider,
                aiModelName: thread.aiModelName,

                createdAtUtc: new Date(),
                updatedAtUtc: new Date(),
            });
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