import mongoose from "mongoose";
import { step1GetConversation } from "../steps/get-conversation";
import { step2QuestionDecomposition } from "../steps/question-decomposition";
import { step3AnswerSubQuestions } from "../steps/answer-sub-questions";
import { step4IntermediateAnswer } from "../steps/generate-intermediate-answer";
import { step5EvaluateAnswer } from "../steps/evaluate-satisfaction";
import { AnswerMachineRepository } from "../database/answer-machine-repository";
import { TokenRepository } from "../database/token-repository";
import { checkIterationLimits, getPreviousGaps, shouldContinueIteration } from "../utils/iteration-helpers";
import { ConversationMessage, IterationLimits, IterationResult } from "../types/answer-machine.types";

/**
 * Processes individual iterations of the answer machine
 */
export class IterationProcessor {

    /**
     * Process a single iteration
     */
    static async processIteration(
        answerMachineId: mongoose.Types.ObjectId,
        threadId: mongoose.Types.ObjectId,
        username: string,
        currentIteration: number,
        minIterations: number,
        maxIterations: number,
        previousGapsFromEvaluation?: string[]
    ): Promise<IterationResult> {
    try {
        console.log(`Processing iteration ${currentIteration} for answer machine ${answerMachineId}`);

        let iterationNumber = currentIteration;

        // Check iteration limits
        const limits = checkIterationLimits(iterationNumber, minIterations, maxIterations);

        // Step 1: Get conversation
        const conversationList = await step1GetConversation({ threadId, username });
            if (conversationList.length === 0) {
                return { shouldContinue: false, errorReason: 'No conversation found' } as IterationResult;
            }

        // Get previous gaps if iteration > 1
        const gapsInfo = getPreviousGaps(iterationNumber, previousGapsFromEvaluation);
        let previousGaps = gapsInfo.previousGaps;
        let isContinuingForMinIterations = gapsInfo.isContinuingForMinIterations;

        // Evaluate previous iteration if needed
        if (gapsInfo.needsEvaluation) {
            const evaluation = await step5EvaluateAnswer({
                answerMachineId,
                threadId,
                username,
                currentIteration: iterationNumber - 1,
            });
            previousGaps = evaluation.gaps;
            console.log(`Iteration ${iterationNumber}: Previous gaps identified:`, previousGaps);
        }

        // Step 2: Create question decomposition
        const questionDecompositionResult = await step2QuestionDecomposition({
            answerMachineId,
            threadId,
            username,
            currentIteration: iterationNumber,
            previousGaps,
            isContinuingForMinIterations,
        });

        // Track tokens from question generation
        if (questionDecompositionResult.tokens) {
            await TokenRepository.trackTokens(
                answerMachineId,
                threadId,
                questionDecompositionResult.tokens,
                username,
                'question_generation'
            );
        }

        console.log(`Iteration ${iterationNumber} - questions generated:`, questionDecompositionResult.questions.length);

        // Check if we've exceeded max iterations
        if (iterationNumber > maxIterations) {
            return { shouldContinue: false } as IterationResult;
        }

        // Handle case where no questions are generated
        if (questionDecompositionResult.questions.length === 0 && iterationNumber === 1) {
            console.log(`Iteration ${iterationNumber}: No questions needed and minimum iterations reached, completing`);
            return { shouldContinue: false } as IterationResult;
        }

        // Step 3: Answer sub-questions
        await step3AnswerSubQuestions({
            answerMachineId,
            threadId,
            username,
        });

        // Step 4: Generate intermediate answer
        const intermediateAnswer = await step4IntermediateAnswer({
            answerMachineId,
            threadId,
            username,
            currentIteration: iterationNumber,
        });

        // Update record with intermediate answer and incremented iteration
        const currentRecord = await AnswerMachineRepository.findById(answerMachineId);
        const currentIntermediateAnswers = currentRecord?.intermediateAnswers || [];

        await AnswerMachineRepository.update(answerMachineId, {
            currentIteration: iterationNumber + 1,
            intermediateAnswers: intermediateAnswer ? [...currentIntermediateAnswers, intermediateAnswer] : currentIntermediateAnswers,
        });

        // Step 5: Evaluate and decide next step
        const updatedLimits = checkIterationLimits(iterationNumber + 1, minIterations, maxIterations);

        if (!updatedLimits.shouldContinue) {
            console.log(`Max iterations (${maxIterations}) reached, completing`);
            return { shouldContinue: false } as IterationResult;
        }

        const evaluation = await step5EvaluateAnswer({
            answerMachineId,
            threadId,
            username,
            currentIteration: iterationNumber + 1,
        });

        console.log(`Iteration ${iterationNumber + 1} evaluation:`, {
            isSatisfactory: evaluation.isSatisfactory,
            gaps: evaluation.gaps.length,
            reasoning: evaluation.reasoning,
        });

        const decision = shouldContinueIteration(evaluation, updatedLimits);

        if (decision.shouldContinue) {
            console.log(`Iteration ${iterationNumber + 1}: ${decision.reason}, continuing to next iteration`);
            return {
                shouldContinue: true,
                nextGaps: evaluation.gaps.length > 0 ? evaluation.gaps : []
            } as IterationResult;
        } else {
            console.log(`Iteration ${iterationNumber + 1}: ${decision.reason}, completing`);
            return { shouldContinue: false } as IterationResult;
        }

        } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Iteration processing failed';
        console.error(`❌ Error in iteration ${currentIteration}:`, errorMessage);
        return { shouldContinue: false, errorReason: errorMessage } as IterationResult;
        }
    }
}