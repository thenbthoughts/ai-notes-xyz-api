import mongoose from "mongoose";
import { AnswerMachineOrchestrator } from "./core/orchestrator";
import { AnswerMachineResult } from "./types/answer-machine.types";

/**
 * Main entry point for the Answer Machine
 * This is a simple wrapper around the orchestrator for backward compatibility
 */
const answerMachineFunc = async ({
    threadId,
    username,
    previousGapsFromEvaluation,
    continueExistingRun = false,
}: {
    threadId: mongoose.Types.ObjectId;
    username: string;
    previousGapsFromEvaluation?: string[];
    continueExistingRun?: boolean;
}): Promise<AnswerMachineResult> => {
    return await AnswerMachineOrchestrator.execute(
        threadId,
        username,
        previousGapsFromEvaluation,
        continueExistingRun
    );
};

export default answerMachineFunc;