import mongoose, { Schema } from 'mongoose';

import { IInfoVaultSignificantDate } from '../../types/typesSchema/typesSchemaInfoVault/SchemaInfoVaultSignificantDate.types';

// InfoVault Significant Date Schema
const infoVaultSignificantDateSchema = new Schema<IInfoVaultSignificantDate>({
    // identification
    infoVaultId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    username: { type: String, required: true, default: '', index: true },

    // fields
    date: { type: Date, default: null },
    label: { type: String, default: '' },

    // auto
    createdAtUtc: { type: Date, default: null },
    createdAtIpAddress: { type: String, default: '' },
    createdAtUserAgent: { type: String, default: '' },
    updatedAtUtc: { type: Date, default: null },
    updatedAtIpAddress: { type: String, default: '' },
    updatedAtUserAgent: { type: String, default: '' },
});

// InfoVault Significant Date Model
const ModelInfoVaultSignificantDate = mongoose.model<IInfoVaultSignificantDate>(
    'infoVaultSignificantDate',
    infoVaultSignificantDateSchema,
    'infoVaultSignificantDate'
);

export {
    ModelInfoVaultSignificantDate
}; 