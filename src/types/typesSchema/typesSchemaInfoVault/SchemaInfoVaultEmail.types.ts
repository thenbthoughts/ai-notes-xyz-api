import mongoose, { Document } from 'mongoose';

// InfoVault Email
export interface IInfoVaultEmail extends Document {
    // identification
    infoVaultId: mongoose.Schema.Types.ObjectId;
    userId: mongoose.Types.ObjectId;

    // fields
    email: string;
    label: string; // e.g., "work", "home", "other", or custom
    isPrimary: boolean; // Whether this is the primary email

    // auto
    createdAtUtc: Date;
    createdAtIpAddress: string;
    createdAtUserAgent: string;
    updatedAtUtc: Date;
    updatedAtIpAddress: string;
    updatedAtUserAgent: string;
} 