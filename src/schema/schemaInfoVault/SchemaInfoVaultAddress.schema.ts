import mongoose, { Schema } from 'mongoose';

import { IInfoVaultAddress } from '../../types/typesSchema/typesSchemaInfoVault/SchemaInfoVaultAddress.types';

// InfoVault Address Schema
const infoVaultAddressSchema = new Schema<IInfoVaultAddress>({
    // identification
    infoVaultId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    username: { type: String, required: true, default: '', index: true },

    // fields
    countryRegion: { type: String, default: '' },
    address: { type: String, default: '' },
    city: { type: String, default: '' },
    pincode: { type: String, default: '' },
    state: { type: String, default: '' },
    poBox: { type: String, default: '' },
    label: { type: String, default: '' },
    latitude: { type: Number, default: 0 },
    longitude: { type: Number, default: 0 },
    isPrimary: { type: Boolean, default: false },

    // auto
    createdAtUtc: { type: Date, default: null },
    createdAtIpAddress: { type: String, default: '' },
    createdAtUserAgent: { type: String, default: '' },
    updatedAtUtc: { type: Date, default: null },
    updatedAtIpAddress: { type: String, default: '' },
    updatedAtUserAgent: { type: String, default: '' },
});

// InfoVault Address Model
const ModelInfoVaultAddress = mongoose.model<IInfoVaultAddress>(
    'infoVaultAddress',
    infoVaultAddressSchema,
    'infoVaultAddress'
);

export {
    ModelInfoVaultAddress
}; 