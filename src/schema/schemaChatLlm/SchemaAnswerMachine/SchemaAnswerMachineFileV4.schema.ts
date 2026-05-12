import mongoose, { Schema } from 'mongoose';

import { IAnswerMachineFileV4 } from '../../../types/typesSchema/typesChatLlm/typesAnswerMachine/SchemaAnswerMachineFileV4.types';

const uploadStatuses = ['uploading', 'saved_to_shell', 'failed'] as const;
const fileRoles = ['user_attachment', 'generated'] as const;

const answerMachineFileV4Schema = new Schema<IAnswerMachineFileV4>({
    /** Set after upload once the AM4 request exists; may be null for pre-send uploads linked at initiate. */
    answerMachineRequestV4Id: {
        type: mongoose.Schema.Types.ObjectId,
        required: false,
        default: null,
        index: true,
        ref: 'answerMachineRequestV4',
    },
    threadId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'chatLlmThread',
    },
    username: { type: String, required: true, index: true },
    fileName: { type: String, required: true, default: '' },
    originalSize: { type: Number, default: 0 },
    mimeType: { type: String, default: 'application/octet-stream' },
    containerPath: { type: String, default: '' },
    shellRelativePath: { type: String, default: '' },
    uploadStatus: {
        type: String,
        enum: uploadStatuses,
        default: 'uploading',
        index: true,
    },
    fileRole: {
        type: String,
        enum: fileRoles,
        default: 'user_attachment',
        index: true,
    },
    storedFileUrl: { type: String, default: '' },
    createdAtUtc: { type: Date, default: () => new Date(), index: true },
});

answerMachineFileV4Schema.index({
    answerMachineRequestV4Id: 1,
    threadId: 1,
    createdAtUtc: -1,
});

const ModelAnswerMachineFileV4 = mongoose.model<IAnswerMachineFileV4>(
    'answerMachineFileV4',
    answerMachineFileV4Schema,
    'answerMachineFileV4'
);

export { ModelAnswerMachineFileV4 };
