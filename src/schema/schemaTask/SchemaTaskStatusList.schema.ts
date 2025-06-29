import mongoose, { Schema } from 'mongoose';

import { tsTaskStatusList } from '../../types/typesSchema/typesSchemaTask/SchemaTaskStatusList.types';

// TaskStatusList Schema
const taskStatusListSchema = new Schema<tsTaskStatusList>({
    // fields
    statusTitle: {
        type: String,
        required: true,
        trim: true,
        default: 'Unassigned',
    },
    listPosition: {
        type: Number,
        required: true,
        default: 100,
    },

    // task workspace id
    taskWorkspaceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'taskWorkspace',
        default: null,
    },

    // auth
    username: {
        type: String,
        required: true,
        default: '',
        index: true,
    },
});

// TaskStatusList Model
const ModelTaskStatusList = mongoose.model<tsTaskStatusList>(
    'taskStatusList',
    taskStatusListSchema,
    'taskStatusList'
);

export {
    ModelTaskStatusList
};