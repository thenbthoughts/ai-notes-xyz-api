import mongoose, { Schema } from 'mongoose';

import { IChatLlmAnswerMachineOpencodeRecord } from '../../../types/typesSchema/typesChatLlm/SchemaChatLlmAnswerMachineOpencodeRecord.types';

const chatLlmAnswerMachineOpencodeRecordSchema = new Schema<IChatLlmAnswerMachineOpencodeRecord>({
    answerMachineRecordId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'chatLlmAnswerMachine',
    },
    threadId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'chatLlmThread',
    },
    username: {
        type: String,
        required: true,
        index: true,
    },
    summary: {
        type: String,
        default: '',
    },
    requestList: {
        type: [String],
        default: [],
    },
    conversation: {
        type: String,
        default: '',
    },
    createdAtUtc: {
        type: Date,
        default: new Date(),
    },
    updatedAtUtc: {
        type: Date,
        default: new Date(),
    },
});

chatLlmAnswerMachineOpencodeRecordSchema.index({ answerMachineRecordId: 1, username: 1 }, { unique: true });

const ModelChatLlmAnswerMachineOpencodeRecord = mongoose.model<IChatLlmAnswerMachineOpencodeRecord>(
    'chatLlmAnswerMachineOpencodeRecord',
    chatLlmAnswerMachineOpencodeRecordSchema,
    'chatLlmAnswerMachineOpencodeRecord'
);

export {
    ModelChatLlmAnswerMachineOpencodeRecord,
};
