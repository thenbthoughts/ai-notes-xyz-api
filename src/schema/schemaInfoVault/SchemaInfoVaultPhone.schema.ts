import mongoose, { Schema } from 'mongoose';

import { IInfoVaultPhone } from '../../types/typesSchema/typesSchemaInfoVault/SchemaInfoVaultPhone.types';

// InfoVault Phone Schema
const infoVaultPhoneSchema = new Schema<IInfoVaultPhone>({
    // identification
    infoVaultId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    username: { type: String, required: true, default: '', index: true },

    // fields
    phoneNumber: { type: String, default: '' },
    countryCode: { type: String, default: '' },
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

// InfoVault Phone Model
const ModelInfoVaultPhone = mongoose.model<IInfoVaultPhone>(
    'infoVaultPhone',
    infoVaultPhoneSchema,
    'infoVaultPhone'
);

export {
    ModelInfoVaultPhone
}; 