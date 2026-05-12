import mongoose, { Schema } from 'mongoose';

import { IAnswerMachineGenerateFinalAnswerV3 } from '../../../types/typesSchema/typesChatLlm/typesAnswerMachine/SchemaAnswerMachineGenerateFinalAnswerV3.types';

const answerMachineGenerateFinalAnswerV3Schema = new Schema<IAnswerMachineGenerateFinalAnswerV3>({
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
    finalAnswerText: { type: String, default: '' },
    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 },
    reasoningTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    costInUsd: { type: Number, default: 0 },
    createdAtUtc: { type: Date, default: () => new Date() },
});

const ModelAnswerMachineGenerateFinalAnswerV3 = mongoose.model<IAnswerMachineGenerateFinalAnswerV3>(
    'answerMachineGenerateFinalAnswerV3',
    answerMachineGenerateFinalAnswerV3Schema,
    'answerMachineGenerateFinalAnswerV3'
);

export { ModelAnswerMachineGenerateFinalAnswerV3 };
