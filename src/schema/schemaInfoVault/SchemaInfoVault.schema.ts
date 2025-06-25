import mongoose, { Schema } from 'mongoose';

import { IInfoVaultContact } from '../../types/typesSchema/typesSchemaInfoVault/SchemaInfoVault.types';

// InfoVault Schema
const infoVaultSchema = new Schema<IInfoVaultContact>({
    // identification
    username: { type: String, required: true, default: '', index: true },

    // basic information
    infoVaultType: {
        type: String,
        default: '',
        // 'myself', 'contact', 'place', 'event', 'document', 'product', 'asset', 'media, 'other'
    },
    infoVaultSubType: {
        type: String,
        default: '',
    },
    name: { type: String, default: '' },
    nickname: { type: String, default: '' },
    photoUrl: { type: String, default: '' },

    // professional information
    company: { type: String, default: '' },
    jobTitle: { type: String, default: '' },
    department: { type: String, default: '' },

    // additional information
    notes: { type: String, default: '' },

    // organization & categorization
    tags: { type: [String], default: [] },
    isFavorite: { type: Boolean, default: false },

    // relationship context
    relationshipType: { type: String, enum: ['myself', 'personal', 'professional', 'family', 'other'], default: 'other' },
    lastContactDate: { type: Date, default: null },
    contactFrequency: { type: String, enum: ['', 'daily', 'weekly', 'monthly', 'yearly', 'rarely'], default: '' },

    // ai enhancement
    aiSummary: { type: String, default: '' },
    aiTags: { type: [String], default: [] },
    aiSuggestions: { type: String, default: '' },

    // status & lifecycle
    isArchived: { type: Boolean, default: false },
    isBlocked: { type: Boolean, default: false },
    lastUpdatedBy: { type: String, default: '' },

    // auto
    createdAtUtc: { type: Date, default: null },
    createdAtIpAddress: { type: String, default: '' },
    createdAtUserAgent: { type: String, default: '' },
    updatedAtUtc: { type: Date, default: null },
    updatedAtIpAddress: { type: String, default: '' },
    updatedAtUserAgent: { type: String, default: '' },
});

// InfoVault Model
const ModelInfoVault = mongoose.model<IInfoVaultContact>(
    'infoVault',
    infoVaultSchema,
    'infoVault'
);

export {
    ModelInfoVault
}; 