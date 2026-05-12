import mongoose, { Schema } from 'mongoose';

import { IAnswerMachineSubQuestionV3 } from '../../../types/typesSchema/typesChatLlm/typesAnswerMachine/SchemaAnswerMachineSubQuestionV3.types';

const kbTypes = ['shortTermMemory', 'notes', 'tasks', 'lifeEvents', 'infoVault', 'memoNotes'];

const verificationVerdicts = ['retry_answer', 'needs_followup_question', 'ready_to_synthesize'];

const answerMachineSubQuestionV3Schema = new Schema<IAnswerMachineSubQuestionV3>({
    threadId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'chatLlmThread',
    },
    parentMessageId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'chatLlm',
    },
    answerMachineRequestV3Id: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'answerMachineRequestV3',
    },
    answerMachineIteration: { type: Number, required: true, index: true },
    username: { type: String, required: true, index: true },
    question: { type: String, default: '' },
    answerReasoningContent: { type: String, default: '' },
    answer: { type: String, default: '' },
    contextIds: [{ type: mongoose.Schema.Types.ObjectId }],
    kind: {
        type: String,
        enum: ['knowledgeBase', 'shell', 'web'],
        default: 'knowledgeBase',
        index: true,
    },
    kbKnowledgeTypes: [
        {
            type: String,
            enum: kbTypes,
        },
    ],
    shellArtifactSummary: { type: String, default: '' },
    webResearchNotes: { type: String, default: '' },
    status: {
        type: String,
        enum: ['pending', 'answered', 'skipped', 'error'],
        default: 'pending',
        index: true,
    },
    errorReason: { type: String, default: '' },
    stepIndex: { type: Number, index: true },
    attemptNumber: { type: Number, default: 1 },
    verificationVerdict: { type: String, enum: verificationVerdicts },
    verificationReason: { type: String, default: '' },
    /** Verifier: whether every implied sub-requirement of the global task is satisfied so far. */
    verificationAllImpliedSubtasksDone: { type: Boolean },
    /** Verifier: whether a final user-facing answer could be delivered now (maps to verdict guidance). */
    verificationFinalAnswerDeliverable: { type: Boolean },
    /** Verifier: short checklist of implied subtasks and status (plain text). */
    verificationGlobalTaskChecklist: { type: String, default: '' },
    executedShellCommand: { type: String, default: '' },
    shellExecutionSuccess: { type: Boolean },
    shellExecutionHttpOk: { type: Boolean },
    shellExecutionExitCode: { type: Number, default: null },
    shellExecutionTimedOut: { type: Boolean },
    shellExecutionStdoutPreview: { type: String, default: '' },
    shellExecutionStderrPreview: { type: String, default: '' },
    shellEnginePreExecuteError: { type: String, default: '' },
    shellRetryGuidance: { type: String, default: '' },
    aiModelName: { type: String, default: '' },
    aiModelProvider: { type: String, default: '' },
    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 },
    reasoningTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    costInUsd: { type: Number, default: 0 },
    createdAtUtc: { type: Date, default: () => new Date() },
    updatedAtUtc: { type: Date, default: () => new Date() },
});

const ModelAnswerMachineSubQuestionV3 = mongoose.model<IAnswerMachineSubQuestionV3>(
    'answerMachineSubQuestionV3',
    answerMachineSubQuestionV3Schema,
    'answerMachineSubQuestionV3'
);

export { ModelAnswerMachineSubQuestionV3 };
