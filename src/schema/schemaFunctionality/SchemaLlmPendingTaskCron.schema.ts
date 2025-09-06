import mongoose, { Schema } from 'mongoose';

import { ILlmPendingTaskCron } from '../../types/typesSchema/typesFunctionality/SchemaLlmPendingTaskCron.types';

// LlmPendingTaskCron Schema
const llmPendingTaskCronSchema = new Schema<ILlmPendingTaskCron>({
    // identification
    username: { type: String, required: true, uniqlowercase: true },

    // task info
    taskType: {
        type: String,
        default: '',
    },
    aiModelName: {
        type: String,
        default: '',
    },
    aiModelProvider: {
        type: String,
        default: '',
    },
    targetRecordId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
    },

    // taskOutput
    taskOutputStr: {
        type: String,
        default: '',
    },
    taskOutputJson: {
        type: Object,
        default: {},
    },

    // task status
    taskStatus: {
        type: String,
        default: 'pending',
        enum: ['pending', 'success', 'failed']
    },
    taskRetryCount: {
        type: Number,
        default: 0,
    },
    taskStatusSuccess: {
        type: String,
        default: '',
    },
    taskStatusFailed: {
        type: String,
        default: '',
    },
    taskTimeTakenInMills: {
        type: Number,
        default: 0,

        // 0 means no value
    },

    // tags
    tags: {
        type: [String],
        default: [],
    },

    // auto
    createdAtUtc: {
        type: Date,
        default: null,
    },
    updatedAtUtc: {
        type: Date,
        default: null,
    },
});

// LlmPendingTaskCron Model
const ModelLlmPendingTaskCron = mongoose.model<ILlmPendingTaskCron>(
    'llmPendingTaskCron',
    llmPendingTaskCronSchema,
    'llmPendingTaskCron'
);

export {
    ModelLlmPendingTaskCron
};