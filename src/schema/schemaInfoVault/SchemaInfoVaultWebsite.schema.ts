import mongoose, { Schema } from 'mongoose';

import { IInfoVaultWebsite } from '../../types/typesSchema/typesSchemaInfoVault/SchemaInfoVaultWebsite.types';

// InfoVault Website Schema
const infoVaultWebsiteSchema = new Schema<IInfoVaultWebsite>({
    // identification
    infoVaultId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    username: { type: String, required: true, default: '', index: true },

    // fields
    url: { type: String, default: '' },
    label: { type: String, default: '' },

    // auto
    createdAtUtc: { type: Date, default: null },
    createdAtIpAddress: { type: String, default: '' },
    createdAtUserAgent: { type: String, default: '' },
    updatedAtUtc: { type: Date, default: null },
    updatedAtIpAddress: { type: String, default: '' },
    updatedAtUserAgent: { type: String, default: '' },
});

// InfoVault Website Model
const ModelInfoVaultWebsite = mongoose.model<IInfoVaultWebsite>(
    'infoVaultWebsite',
    infoVaultWebsiteSchema,
    'infoVaultWebsite'
);

export {
    ModelInfoVaultWebsite
}; 