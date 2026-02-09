import mongoose, { Schema } from 'mongoose';

import { IUserMemory } from '../../types/typesSchema/typesUser/SchemaUserMemory.types';

// User Memory Schema
const userMemorySchema = new Schema<IUserMemory>({
    // identification
    username: { type: String, required: true, default: '', index: true },

    // fields
    content: {
        type: String,
        default: '',
    },
    isPermanent: {
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

// User Memory Model
const ModelUserMemory = mongoose.model<IUserMemory>(
    'userMemory',
    userMemorySchema,
    'userMemory'
);

export {
    ModelUserMemory
};
