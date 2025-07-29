import mongoose, { Schema } from 'mongoose';
import { tsTaskList } from '../../types/typesSchema/typesSchemaTask/SchemaTaskList2.types';

const taskSchema = new Schema<tsTaskList>({
    // Task specific fields
    title: {
        type: String,
        default: '',
        trim: true,
    },
    description: {
        type: String,
        default: '',
        trim: true,
    },
    //
    priority: {
        type: String,
        default: '',
        enum: ['', 'very-low', 'low', 'medium', 'high', 'very-high']
    },
    dueDate: {
        type: Date,
        default: null,
    },
    checklist: {
        type: [String],
        default: [],
    },
    comments: {
        type: [String],
        default: [],
    },

    // identification
    taskWorkspaceId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
    },
    taskStatusId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
    },

    // status
    isArchived: {
        type: Boolean,
        default: false,
    },
    isCompleted: {
        type: Boolean,
        default: false,
    },

    labels: {
        type: [String],
        default: [],
    },
    labelsAi: {
        type: [String],
        default: [],
    },

    // auth
    username: {
        type: String,
        required: true,
        default: '',
        index: true,
    },

    // task homepage pinned
    isTaskPinned: {
        type: Boolean,
        default: false,
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

const ModelTask = mongoose.model<tsTaskList>(
    'tasks',
    taskSchema,
    'tasks'
);

export {
    ModelTask
};