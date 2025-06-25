import mongoose, { Schema } from 'mongoose';

import { IInfoVaultRelatedPerson } from '../../types/typesSchema/typesSchemaInfoVault/SchemaInfoVaultRelatedPerson.types';

// InfoVault Related Person Schema
const infoVaultRelatedPersonSchema = new Schema<IInfoVaultRelatedPerson>({
    // identification
    infoVaultId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    username: { type: String, required: true, default: '', index: true },

    // fields
    relatedPersonName: { type: String, default: '' },
    label: { type: String, default: '' },

    // auto
    createdAtUtc: { type: Date, default: null },
    createdAtIpAddress: { type: String, default: '' },
    createdAtUserAgent: { type: String, default: '' },
    updatedAtUtc: { type: Date, default: null },
    updatedAtIpAddress: { type: String, default: '' },
    updatedAtUserAgent: { type: String, default: '' },
});

// InfoVault Related Person Model
const ModelInfoVaultRelatedPerson = mongoose.model<IInfoVaultRelatedPerson>(
    'infoVaultRelatedPerson',
    infoVaultRelatedPersonSchema,
    'infoVaultRelatedPerson'
);

export {
    ModelInfoVaultRelatedPerson
}; 