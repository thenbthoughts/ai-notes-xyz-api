import mongoose, { Schema } from 'mongoose';
import { IGlobalSearch } from '../../types/typesSchema/typesGlobalSearch/SchemaGlobalSearch.types';

const globalSearchSchema = new Schema<IGlobalSearch>({
    // Search fields
    text: {
        type: String,
        default: '',
        index: true,
    },
    ngram: {
        type: [String],
        default: [],
        index: true,
    },

    // Reference fields
    entityId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
    },
    username: {
        type: String,
        required: true,
        default: '',
        index: true,
    },
    collectionName: {
        type: String,
        required: true,
        default: '',
        enum: [
            'tasks',
            'notes',
            'lifeEvents',
            'infoVault',
            'chatLlmThread',
        ],
    },

    // Metadata fields for filtering
    taskIsCompleted: {
        type: Boolean,
        default: false,
    },
    taskIsArchived: {
        type: Boolean,
        default: false,
    },
    taskWorkspaceId: {
        type: mongoose.Schema.Types.ObjectId,
        default: new mongoose.Types.ObjectId(),
    },
    notesWorkspaceId: {
        type: mongoose.Schema.Types.ObjectId,
        default: new mongoose.Types.ObjectId(),
    },
    lifeEventIsDiary: {
        type: Boolean,
        default: false,
    },

    // Sorting
    updatedAtUtc: {
        type: Date,
        default: new Date(),
        index: true,
    },
});

// Create indexes
globalSearchSchema.index({ text: 'text' }); // Text index for full-text search
globalSearchSchema.index({ username: 1, entityType: 1 }); // Compound index for filtering
globalSearchSchema.index({ entityId: 1, entityType: 1 }); // Compound index for entity lookup

// GlobalSearch Model
const ModelGlobalSearch = mongoose.model<IGlobalSearch>(
    'globalSearch',
    globalSearchSchema,
    'globalSearch'
);

export {
    ModelGlobalSearch
};

