import mongoose from "mongoose";
import { AnswerMachineRepository } from "../database/answer-machine-repository";
import { RunManager } from "./run-manager";
import { IterationProcessor } from "./iteration-processor";
import { validateAndGetSettings, updateThreadStatus } from "../utils/iteration-helpers";
import { completeAnswerMachine, createFinalAnswerMessage } from "../utils/completion-handler";
import { FinalAnswerGenerator } from "../services/final-answer-generator";
import { AnswerMachineResult } from "../types/answer-machine.types";

/**
 * Main orchestrator for the Answer Machine
 */
export class AnswerMachineOrchestrator {

    /**
     * Execute the complete answer machine workflow
     */
    static async execute(
        threadId: mongoose.Types.ObjectId,
        username: string,
        previousGapsFromEvaluation?: string[],
        continueExistingRun = false
    ): Promise<AnswerMachineResult> {
        try {
            // Step 1: Validate settings and get thread info
            const settings = await validateAndGetSettings(threadId);
            if (!settings.success || !settings.thread || settings.minIterations === undefined ||
                settings.maxIterations === undefined) {
                const errorReason = settings.errorReason || 'Validation failed or missing settings';
                await updateThreadStatus(threadId, 'error', { errorReason });
                return { success: false, errorReason, data: null } as AnswerMachineResult;
            }

            const { thread, minIterations, maxIterations } = settings;

            // Step 2: Initialize or continue run
            const runResult = await RunManager.initializeOrContinueRun(
                threadId,
                thread,
                username,
                continueExistingRun
            );

            if (!runResult.success) {
                await updateThreadStatus(threadId, 'error', { errorReason: runResult.errorReason });
                return { success: false, errorReason: runResult.errorReason || 'Failed to initialize run', data: null } as AnswerMachineResult;
            }

            const { answerMachineId, currentIteration } = runResult;
            if (!currentIteration || !answerMachineId) {
                await updateThreadStatus(threadId, 'error', { errorReason: 'Failed to get current iteration' });
                return { success: false, errorReason: 'Failed to get current iteration', data: null } as AnswerMachineResult;
            }

        // Step 3: Process iterations until completion
        let iterationGaps = previousGapsFromEvaluation;
        let iterationCounter = currentIteration;

        while (true) {
            const iterationResult = await IterationProcessor.processIteration(
                answerMachineId,
                threadId,
                username,
                iterationCounter,
                minIterations,
                maxIterations,
                iterationGaps
            );

            if (iterationResult.errorReason) {
                console.error(`[Orchestrator] Iteration ${iterationCounter} error: ${iterationResult.errorReason}`);
                return await this.failWithIterationError(threadId, iterationResult.errorReason);
            }

            if (!iterationResult.shouldContinue) {
                return await this.finalizeAnswerMachine(threadId, username, answerMachineId);
            }

            iterationCounter++;
            iterationGaps = iterationResult.nextGaps ?? [];
        }

        } catch (error) {
            console.error(`❌ Error in AnswerMachineOrchestrator (thread ${threadId}):`, error);
            const errorMessage = error instanceof Error ? error.message : 'Internal server error';

            try {
                await updateThreadStatus(threadId, 'error', { errorReason: errorMessage });
            } catch (updateError) {
                console.error('Failed to update thread error status:', updateError);
            }

            return {
                success: false,
                errorReason: errorMessage,
                data: null,
            } as AnswerMachineResult;
        }
    }

    private static async finalizeAnswerMachine(
        threadId: mongoose.Types.ObjectId,
        username: string,
        answerMachineId: mongoose.Types.ObjectId
    ): Promise<AnswerMachineResult> {
        console.log(`[Orchestrator] Generating final answer for thread ${threadId}`);
        console.log(`[Orchestrator] Answer Machine ID: ${answerMachineId}`);
        const finalAnswerResult = await FinalAnswerGenerator.generateFinalAnswer(
            threadId,
            username,
            answerMachineId
        );

        console.log(`[Orchestrator] Final answer generation result:`, {
            success: finalAnswerResult.success,
            hasAnswer: !!finalAnswerResult.answer,
            answerLength: finalAnswerResult.answer?.length || 0,
            errorReason: finalAnswerResult.errorReason
        });

        if (!finalAnswerResult.success || !finalAnswerResult.answer) {
            const errorMsg = finalAnswerResult.errorReason || 'Failed to generate final answer';
            console.error(`[Orchestrator] Final answer generation failed: ${errorMsg}`);
            return await this.failWithIterationError(threadId, errorMsg);
        }

        await AnswerMachineRepository.update(answerMachineId, {
            finalAnswer: finalAnswerResult.answer,
        });

        await createFinalAnswerMessage(threadId, username, finalAnswerResult.answer);
        await completeAnswerMachine(threadId, username);

        console.log(`[Orchestrator] Answer Machine completed successfully with final answer for thread ${threadId}`);
        return {
            success: true,
            errorReason: '',
            data: null,
        } as AnswerMachineResult;
    }

    private static async failWithIterationError(
        threadId: mongoose.Types.ObjectId,
        errorReason: string
    ): Promise<AnswerMachineResult> {
        await updateThreadStatus(threadId, 'error', { errorReason });
        return {
            success: false,
            errorReason,
            data: null,
        } as AnswerMachineResult;
    }
}
