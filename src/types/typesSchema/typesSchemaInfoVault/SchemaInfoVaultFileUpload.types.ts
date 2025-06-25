import mongoose, { Document } from 'mongoose';

// InfoVault File Upload
export interface IInfoVaultFileUpload extends Document {
    // identification
    infoVaultId: mongoose.Schema.Types.ObjectId;
    username: string;

    // file fields
    fileType: string;
    fileUrl: string;
    fileTitle: string;
    fileDescription: string;

    // ai
    aiTitle: string;
    aiSummaryContext: string;
    aiSummarySpecific: string;
    aiTags: string[];

    // auto
    createdAtUtc: Date;
    createdAtIpAddress: string;
    createdAtUserAgent: string;
    updatedAtUtc: Date;
    updatedAtIpAddress: string;
    updatedAtUserAgent: string;
};