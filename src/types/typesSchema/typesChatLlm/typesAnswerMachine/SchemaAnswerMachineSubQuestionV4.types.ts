import mongoose, { Document } from 'mongoose';

/** AM4 sub-steps are executed via OpenCode only. */
export type AnswerMachineSubQuestionKindV4 = 'opencode';

export type AnswerMachineVerificationVerdictV4 =
    | 'retry_answer'
    | 'needs_followup_question'
    | 'ready_to_synthesize';

export interface IAnswerMachineSubQuestionV4 extends Document {
    _id: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    parentMessageId: mongoose.Types.ObjectId;
    answerMachineRequestV4Id: mongoose.Types.ObjectId;
    answerMachineIteration: number;

    username: string;

    question: string;
    answerReasoningContent: string;
    answer: string;

    kind: AnswerMachineSubQuestionKindV4;

    status: 'pending' | 'answered' | 'skipped' | 'error';
    errorReason: string;

    stepIndex?: number;
    attemptNumber?: number;

    verificationVerdict?: AnswerMachineVerificationVerdictV4;
    verificationReason?: string;
    verificationAllImpliedSubtasksDone?: boolean;
    verificationFinalAnswerDeliverable?: boolean;
    verificationGlobalTaskChecklist?: string;

    /** Container paths (or labels) the model was told to use for this step. */
    contextFilesUsed: string[];

    aiModelName: string;
    aiModelProvider: string;
    promptTokens: number;
    completionTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    costInUsd: number;

    createdAtUtc: Date;
    updatedAtUtc: Date;
}
