import mongoose, { Schema } from 'mongoose';

import { IAnswerMachineEvaluateAnswerV4 } from '../../../types/typesSchema/typesChatLlm/typesAnswerMachine/SchemaAnswerMachineEvaluateAnswerV4.types';

const answerMachineEvaluateAnswerV4Schema = new Schema<IAnswerMachineEvaluateAnswerV4>({
    answerMachineRequestV4Id: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'answerMachineRequestV4',
    },
    threadId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'chatLlmThread',
    },
    userId: { type: Schema.Types.ObjectId, ref: 'user', required: true, index: true },
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

const ModelAnswerMachineEvaluateAnswerV4 = mongoose.model<IAnswerMachineEvaluateAnswerV4>(
    'answerMachineEvaluateAnswerV4',
    answerMachineEvaluateAnswerV4Schema,
    'answerMachineEvaluateAnswerV4'
);

export { ModelAnswerMachineEvaluateAnswerV4 };
