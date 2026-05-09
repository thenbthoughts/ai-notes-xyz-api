import mongoose, { Schema } from 'mongoose';

import { IAnswerMachinePipelineVisualV3 } from '../../../types/typesSchema/typesChatLlm/typesAnswerMachine/SchemaAnswerMachinePipelineVisualV3.types';

const answerMachinePipelineVisualV3Schema = new Schema<IAnswerMachinePipelineVisualV3>({
    threadId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'chatLlmThread',
    },
    username: { type: String, required: true, index: true },
    answerMachineRequestV3Id: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'answerMachineRequestV3',
    },
    answerMachineIteration: { type: Number, required: true },
    inputImageStoredFileUrl: { type: String, default: '' },
    outputImageStoredFileUrl: { type: String, default: '' },
    schemaVersion: { type: Number, default: 1 },
    createdAt: { type: Date, default: () => new Date() },
    updatedAt: { type: Date, default: () => new Date() },
});

answerMachinePipelineVisualV3Schema.index(
    { answerMachineRequestV3Id: 1, answerMachineIteration: 1 },
    { unique: true }
);

const ModelAnswerMachinePipelineVisualV3 = mongoose.model<IAnswerMachinePipelineVisualV3>(
    'answerMachinePipelineVisualV3',
    answerMachinePipelineVisualV3Schema,
    'answerMachinePipelineVisualV3'
);

export { ModelAnswerMachinePipelineVisualV3 };
