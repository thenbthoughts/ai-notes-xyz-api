import mongoose from "mongoose";
import { AnswerMachineRepository } from "../database/answer-machine-repository";
import { ChatLlmThread, RunInitializationResult, ContinuationInfo } from "../types/answer-machine.types";

/**
 * Manages answer machine run initialization and continuation
 */
export class RunManager {

    /**
     * Initialize a new run or continue an existing one
     */
    static async initializeOrContinueRun(
        threadId: mongoose.Types.ObjectId,
        thread: ChatLlmThread,
        username: string,
        continueExistingRun: boolean
    ): Promise<RunInitializationResult> {
        if (continueExistingRun) {
            const continuationInfo = await AnswerMachineRepository.getContinuationInfo(threadId);
            if (continuationInfo) {
                console.log(`Continuing existing run at iteration ${continuationInfo.currentIteration}`);
                return {
                    success: true,
                    answerMachineId: continuationInfo.answerMachineId,
                    currentIteration: continuationInfo.currentIteration,
                } as RunInitializationResult;
            } else {
                console.log('Existing answer machine record not found, starting fresh');
                // Fall through to new run initialization
            }
        }

        // Initialize new run
        const initResult = await AnswerMachineRepository.initializeNewRun(threadId, username);
        if (!initResult.success || !initResult.answerMachineId) {
            return {
                success: false,
                answerMachineId: new mongoose.Types.ObjectId(), // dummy value
                currentIteration: 1,
                errorReason: initResult.errorReason || 'Failed to initialize run'
            } as RunInitializationResult;
        }

        return {
            success: true,
            answerMachineId: initResult.answerMachineId,
            currentIteration: 1,
        } as RunInitializationResult;
    }
}