import mongoose, { Schema } from 'mongoose';
import { tsTaskCommentList } from '../types/typesSchema/schemaTaskCommentList.types';

// taskCommentSchema
const taskCommentSchema = new Schema<tsTaskCommentList>({
    // Comment specific fields
    commentText: {
        type: String,
        default: '',
        trim: true,
    },
    isAi: {
        type: Boolean,
        default: false,
    },

    // auth
    username: {
        type: String,
        required: true,
        default: '',
        index: true,
    },

    // Reference to the task
    taskId: {
        type: String,
        required: true,
        default: '',
    },

    // auto
    createdAtUtc: {
        type: Date,
        default: null,
    },
    createdAtIpAddress: {
        type: String,
        default: '',
    },
    createdAtUserAgent: {
        type: String,
        default: '',
    },
    updatedAtUtc: {
        type: Date,
        default: null,
    },
    updatedAtIpAddress: {
        type: String,
        default: '',
    },
    updatedAtUserAgent: {
        type: String,
        default: '',
    },
});

// Comment Model
const ModelTaskComments = mongoose.model<tsTaskCommentList>(
    'taskComments',
    taskCommentSchema,
    'taskComments'
);

export {
    ModelTaskComments
};