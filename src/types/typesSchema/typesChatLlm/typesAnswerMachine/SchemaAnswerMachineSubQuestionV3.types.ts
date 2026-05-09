import mongoose, { Document } from 'mongoose';

export type AnswerMachineKbKnowledgeTypeV3 =
    | 'shortTermMemory'
    | 'notes'
    | 'tasks'
    | 'lifeEvents'
    | 'infoVault'
    | 'memoNotes';

export type AnswerMachineSubQuestionKindV3 = 'knowledgeBase' | 'shell' | 'web';

/** Set by the AM3 verifier after each answered step (sequential reasoning loop). */
export type AnswerMachineVerificationVerdictV3 =
    | 'retry_answer'
    | 'needs_followup_question'
    | 'ready_to_synthesize';

export interface IAnswerMachineSubQuestionV3 extends Document {
    _id: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    parentMessageId: mongoose.Types.ObjectId;
    answerMachineRequestV3Id: mongoose.Types.ObjectId;
    answerMachineIteration: number;

    username: string;

    question: string;
    answerReasoningContent: string;
    answer: string;
    contextIds: mongoose.Types.ObjectId[];

    kind: AnswerMachineSubQuestionKindV3;
    kbKnowledgeTypes: AnswerMachineKbKnowledgeTypeV3[];

    shellArtifactSummary: string;
    webResearchNotes: string;

    status: 'pending' | 'answered' | 'skipped' | 'error';
    errorReason: string;

    /** Monotonic step order within one outer `answerMachineIteration` on the request (sequential AM3). */
    stepIndex?: number;
    /** 1-based attempt for this stepIndex (retries after verify: retry_answer). */
    attemptNumber?: number;
    verificationVerdict?: AnswerMachineVerificationVerdictV3;
    verificationReason?: string;
    verificationAllImpliedSubtasksDone?: boolean;
    verificationFinalAnswerDeliverable?: boolean;
    verificationGlobalTaskChecklist?: string;

    executedShellCommand?: string;
    shellExecutionSuccess?: boolean;
    shellExecutionHttpOk?: boolean;
    shellExecutionExitCode?: number | null;
    shellExecutionTimedOut?: boolean;
    shellExecutionStdoutPreview?: string;
    shellExecutionStderrPreview?: string;
    shellEnginePreExecuteError?: string;
    shellRetryGuidance?: string;

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
