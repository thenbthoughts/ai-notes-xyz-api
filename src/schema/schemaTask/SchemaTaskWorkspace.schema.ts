import mongoose, { Schema } from 'mongoose';

import { ITaskWorkspace } from '../../types/typesSchema/typesSchemaTask/SchemaTaskWorkspace.types';

// Task Workspace Schema
const taskWorkspaceSchema = new Schema<ITaskWorkspace>({
    // identification
    username: { type: String, required: true, default: '', index: true },

    // fields
    title: { type: String, default: '' },
    description: { type: String, default: '' },
    isStar: { type: Boolean, default: false },
    tags: { type: [String], default: [] },

    // ai
    aiSummary: { type: String, default: '' },
    aiTags: { type: [String], default: [] },
    aiSuggestions: { type: String, default: '' },

    // auto
    createdAtUtc: { type: Date, default: null },
    createdAtIpAddress: { type: String, default: '' },
    createdAtUserAgent: { type: String, default: '' },
    updatedAtUtc: { type: Date, default: null },
    updatedAtIpAddress: { type: String, default: '' },
    updatedAtUserAgent: { type: String, default: '' },
});

// Task Workspace Model
const ModelTaskWorkspace = mongoose.model<ITaskWorkspace>(
    'taskWorkspace',
    taskWorkspaceSchema,
    'taskWorkspace'
);

export {
    ModelTaskWorkspace
};