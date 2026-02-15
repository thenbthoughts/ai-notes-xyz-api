import mongoose, { Schema } from 'mongoose';

import { IChatLlmAnswerMachineTokenRecord } from '../../../types/typesSchema/typesChatLlm/SchemaChatLlmAnswerMachineTokenRecord.types';

const chatLlmAnswerMachineTokenRecordSchema = new Schema<IChatLlmAnswerMachineTokenRecord>({
    // reference to thread
    threadId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'chatLlmThread',
    },
    
    // query type
    queryType: {
        type: String,
        enum: ['question_generation', 'sub_question_answer', 'intermediate_answer', 'evaluation', 'final_answer'],
        required: true,
        index: true,
    },
    
    // token counts for this single execution
    promptTokens: {
        type: Number,
        default: 0,
    },
    completionTokens: {
        type: Number,
        default: 0,
    },
    reasoningTokens: {
        type: Number,
        default: 0,
    },
    totalTokens: {
        type: Number,
        default: 0,
    },
    costInUsd: {
        type: Number,
        default: 0,
    },
    
    // auth
    username: {
        type: String,
        required: true,
        default: '',
        index: true,
    },
    
    // auto
    createdAtUtc: {
        type: Date,
        default: new Date(),
    },
});

const ModelChatLlmAnswerMachineTokenRecord = mongoose.model<IChatLlmAnswerMachineTokenRecord>(
    'chatLlmAnswerMachineTokenRecord',
    chatLlmAnswerMachineTokenRecordSchema,
    'chatLlmAnswerMachineTokenRecord'
);

export {
    ModelChatLlmAnswerMachineTokenRecord
};
