import mongoose, { Document } from 'mongoose';

// InfoVault Phone
export interface IInfoVaultPhone extends Document {
    // identification
    infoVaultId: mongoose.Schema.Types.ObjectId;
    userId: mongoose.Types.ObjectId;

    // fields
    phoneNumber: string;
    countryCode: string; // e.g., "+1", "+44", etc.
    label: string; // e.g., "mobile", "work", "home", "other", or custom
    isPrimary: boolean; // Whether this is the primary phone number

    // auto
    createdAtUtc: Date;
    createdAtIpAddress: string;
    createdAtUserAgent: string;
    updatedAtUtc: Date;
    updatedAtIpAddress: string;
    updatedAtUserAgent: string;
} 