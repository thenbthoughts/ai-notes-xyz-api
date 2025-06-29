import mongoose, { Schema } from 'mongoose';
import { tsTaskSubList } from '../../types/typesSchema/typesSchemaTask/schemaTaskSubList.types';

// Task Sub List Schema
const taskSubListSchema = new Schema<tsTaskSubList>({
    // Subtask specific fields
    title: {
        type: String,
        required: true,
        trim: true,
    },
    parentTaskId: {
        type: mongoose.Schema.Types.ObjectId, // Changed to MongoDB ObjectId
        required: true,
    },
    taskCompletedStatus: {
        type: Boolean,
        default: false,
    },
    taskPosition: {
        type: Number,
        required: true,
    },

    // auth
    username: {
        type: String,
        required: true,
        index: true,
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

// Task Sub List Model
const ModelTaskSubList = mongoose.model<tsTaskSubList>(
    'tasksSub', // Updated collection name
    taskSubListSchema,
    'tasksSub'  // Updated collection name
);

export {
    ModelTaskSubList
};