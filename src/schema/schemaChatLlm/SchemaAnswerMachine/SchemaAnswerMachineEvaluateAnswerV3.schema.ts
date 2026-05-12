import mongoose, { Schema } from 'mongoose';

import { IAnswerMachineEvaluateAnswerV3 } from '../../../types/typesSchema/typesChatLlm/typesAnswerMachine/SchemaAnswerMachineEvaluateAnswerV3.types';

const answerMachineEvaluateAnswerV3Schema = new Schema<IAnswerMachineEvaluateAnswerV3>({
    answerMachineRequestV3Id: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'answerMachineRequestV3',
    },
    threadId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'chatLlmThread',
    },
    username: { type: String, required: true, index: true },
    isSatisfactory: { type: Boolean, default: false },
    confidence: { type: Number, default: 0 },
    evaluationReason: { type: String, default: '' },
    evaluationAllImpliedSubtasksDone: { type: Boolean, default: false },
    evaluationFinalAnswerDeliverable: { type: Boolean, default: false },
    evaluationGlobalTaskChecklist: { type: String, default: '' },
    insertedChatMessageId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
        ref: 'chatLlm',
    },
    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 },
    reasoningTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    costInUsd: { type: Number, default: 0 },
    createdAtUtc: { type: Date, default: () => new Date() },
});

const ModelAnswerMachineEvaluateAnswerV3 = mongoose.model<IAnswerMachineEvaluateAnswerV3>(
    'answerMachineEvaluateAnswerV3',
    answerMachineEvaluateAnswerV3Schema,
    'answerMachineEvaluateAnswerV3'
);

export { ModelAnswerMachineEvaluateAnswerV3 };
