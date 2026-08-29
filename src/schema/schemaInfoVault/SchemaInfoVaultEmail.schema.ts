import mongoose, { Schema } from 'mongoose';

import { IInfoVaultEmail } from '../../types/typesSchema/typesSchemaInfoVault/SchemaInfoVaultEmail.types';

// InfoVault Email Schema
const infoVaultEmailSchema = new Schema<IInfoVaultEmail>({
    // identification
    infoVaultId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'user', required: true, index: true },

    // fields
    email: { type: String, default: '' },
    label: { type: String, default: '' },
    isPrimary: { type: Boolean, default: false },

    // auto
    createdAtUtc: { type: Date, default: null },
    createdAtIpAddress: { type: String, default: '' },
    createdAtUserAgent: { type: String, default: '' },
    updatedAtUtc: { type: Date, default: null },
    updatedAtIpAddress: { type: String, default: '' },
    updatedAtUserAgent: { type: String, default: '' },
});

// InfoVault Email Model
const ModelInfoVaultEmail = mongoose.model<IInfoVaultEmail>(
    'infoVaultEmail',
    infoVaultEmailSchema,
    'infoVaultEmail'
);

export {
    ModelInfoVaultEmail
};

