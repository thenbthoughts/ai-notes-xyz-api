import mongoose, { Document } from 'mongoose';

// InfoVault Website
export interface IInfoVaultWebsite extends Document {
    // identification
    infoVaultId: mongoose.Schema.Types.ObjectId;
    userId: mongoose.Types.ObjectId;

    // fields
    url: string;
    label: string;

    // auto
    createdAtUtc: Date;
    createdAtIpAddress: string;
    createdAtUserAgent: string;
    updatedAtUtc: Date;
    updatedAtIpAddress: string;
    updatedAtUserAgent: string;
}; 