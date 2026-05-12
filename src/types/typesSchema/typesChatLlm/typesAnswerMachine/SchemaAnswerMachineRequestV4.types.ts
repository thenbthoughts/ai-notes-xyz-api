import mongoose, { Document } from 'mongoose';

/** Answer Machine V4 root run (Opencode + Shell large-file bridge). */
export interface IAnswerMachineRequestV4 extends Document {
    _id: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    parentMessageId: mongoose.Types.ObjectId;
    username: string;

    schemaVersion: 4;

    status: 'pending' | 'answered' | 'error';
    errorReason: string;

    minNumberOfIterations: number;
    maxNumberOfIterations: number;
    currentIteration: number;

    intermediateAnswers: string[];
    finalAnswer: string;
    isSatisfactoryFinalAnswer?: boolean;

    globalTaskDescription: string;
    /** Refs to `answerMachineFileV4` documents (user uploads + registered outputs). */
    attachedFiles: mongoose.Types.ObjectId[];

    /** OpenCode session reused across outer iterations for this request. */
    opencodeSessionId: string;

    /**
     * Last OpenCode executor model key (`providerID:modelID`) used with `opencodeSessionId`.
     * If this diverges from the current mapped executor model, the session is reset.
     */
    am4OpencodeExecutorModelKey: string;

    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalReasoningTokens: number;
    totalTokens: number;
    costInUsd: number;

    createdAt: Date;
    updatedAt: Date;
}
