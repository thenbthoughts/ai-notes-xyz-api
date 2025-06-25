import mongoose, { Schema } from 'mongoose';

import { IInfoVaultFileUpload } from '../../types/typesSchema/typesSchemaInfoVault/SchemaInfoVaultFileUpload.types';

// InfoVaultFileUpload Schema
const infoVaultFileUploadSchema = new Schema<IInfoVaultFileUpload>({
    // identification
    username: { type: String, required: true, default: '', index: true },
    infoVaultId: { type: mongoose.Schema.Types.ObjectId, default: null },

    // file fields
    fileType: {
        type: String,
        required: true,
        default: '',
        // fileType "image", "video", "audio" or "file"
    },
    fileUrl: { type: String, required: true, default: '' },
    fileTitle: { type: String, default: '' },
    fileDescription: { type: String, default: '' },

    // ai
    aiTitle: { type: String, default: '' },
    aiSummaryContext: { type: String, default: '' },
    aiSummarySpecific: { type: String, default: '' },
    aiTags: { type: [String], default: [] },

    // auto
    createdAtUtc: { type: Date, default: null },
    createdAtIpAddress: { type: String, default: '' },
    createdAtUserAgent: { type: String, default: '' },
    updatedAtUtc: { type: Date, default: null },
    updatedAtIpAddress: { type: String, default: '' },
    updatedAtUserAgent: { type: String, default: '' },
});

// InfoVaultFileUpload Model
const ModelInfoVaultFileUpload = mongoose.model<IInfoVaultFileUpload>(
    'infoVaultFileUpload',
    infoVaultFileUploadSchema,
    'infoVaultFileUpload'
);

export {
    ModelInfoVaultFileUpload
};