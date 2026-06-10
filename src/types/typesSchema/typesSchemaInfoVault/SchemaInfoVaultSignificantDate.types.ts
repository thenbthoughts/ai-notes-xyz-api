import mongoose, { Document } from 'mongoose';

// InfoVault Significant Date
export interface IInfoVaultSignificantDate extends Document {
    // identification
    infoVaultId: mongoose.Schema.Types.ObjectId;
    userId: mongoose.Types.ObjectId;

    // fields
    date: Date;
    label: string;

    // auto
    createdAtUtc: Date;
    createdAtIpAddress: string;
    createdAtUserAgent: string;
    updatedAtUtc: Date;
    updatedAtIpAddress: string;
    updatedAtUserAgent: string;
}; 