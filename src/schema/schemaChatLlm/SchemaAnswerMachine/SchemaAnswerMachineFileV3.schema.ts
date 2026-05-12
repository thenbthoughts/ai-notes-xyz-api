import mongoose, { Schema } from 'mongoose';

import { IAnswerMachineFileV3 } from '../../../types/typesSchema/typesChatLlm/typesAnswerMachine/SchemaAnswerMachineFileV3.types';

/**
 * Answer Machine V3 file registry (`answerMachineFilesV3`): shell-imported outputs, chat attachments,
 * and UI uploads (`POST /api/chat-llm/crud/answerMachineFileV3Upload`) referencing the same storage keys as `getFile`.
 */
const answerMachineFileV3Schema = new Schema<IAnswerMachineFileV3>({
    answerMachineRequestV3Id: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'answerMachineRequestV3',
    },
    /** Outer loop counter on the request (for stream grouping / file scoping). */
    answerMachineIteration: { type: Number, default: null, index: true },
    answerMachineSubQuestionV3Id: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
        index: true,
        ref: 'answerMachineSubQuestionV3',
    },

    threadId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'chatLlmThread',
    },
    username: { type: String, required: true, index: true },

    fileType: {
        type: String,
        enum: ['user_upload', 'generated'],
        required: true,
        index: true,
    },
    purpose: {
        type: String,
        enum: [
            'image_rotation',
            'data_analysis',
            'graph_generation',
            'shell_generated',
            'user_attachment',
            'other',
        ],
        default: 'other',
        index: true,
    },

    storedFileUrl: { type: String, required: true, default: '' },
    originalName: { type: String, default: '' },
    mimeType: { type: String, default: 'application/octet-stream' },
    sizeBytes: { type: Number, default: 0 },

    relativeShellPath: { type: String, default: '' },
    description: { type: String, default: '' },
    metadata: { type: Schema.Types.Mixed, default: {} },

    createdAtUtc: { type: Date, default: () => new Date(), index: true },
});

answerMachineFileV3Schema.index({
    answerMachineRequestV3Id: 1,
    threadId: 1,
    createdAtUtc: -1,
});

const ModelAnswerMachineFileV3 = mongoose.model<IAnswerMachineFileV3>(
    'answerMachineFilesV3',
    answerMachineFileV3Schema,
    'answerMachineFilesV3',
);

export { ModelAnswerMachineFileV3 };
