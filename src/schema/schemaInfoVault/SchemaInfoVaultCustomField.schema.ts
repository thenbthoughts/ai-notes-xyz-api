import mongoose, { Schema } from 'mongoose';

import { IInfoVaultCustomField } from '../../types/typesSchema/typesSchemaInfoVault/SchemaInfoVaultCustomField.types';

// InfoVault Custom Field Schema
const infoVaultCustomFieldSchema = new Schema<IInfoVaultCustomField>({
    // identification
    infoVaultId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    username: { type: String, required: true, default: '', index: true },

    // fields
    key: { type: String, default: '' },
    value: { type: String, default: '' },

    // auto
    createdAtUtc: { type: Date, default: null },
    createdAtIpAddress: { type: String, default: '' },
    createdAtUserAgent: { type: String, default: '' },
    updatedAtUtc: { type: Date, default: null },
    updatedAtIpAddress: { type: String, default: '' },
    updatedAtUserAgent: { type: String, default: '' },
});

// InfoVault Custom Field Model
const ModelInfoVaultCustomField = mongoose.model<IInfoVaultCustomField>(
    'infoVaultCustomField',
    infoVaultCustomFieldSchema,
    'infoVaultCustomField'
);

export {
    ModelInfoVaultCustomField
}; 