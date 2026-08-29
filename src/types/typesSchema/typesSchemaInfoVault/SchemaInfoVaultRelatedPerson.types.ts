import mongoose, { Document } from 'mongoose';

// InfoVault Related Person
export interface IInfoVaultRelatedPerson extends Document {
    // identification
    infoVaultId: mongoose.Schema.Types.ObjectId;
    userId: mongoose.Types.ObjectId;

    // fields
    relatedPersonName: string;
    label: string;

    // auto
    createdAtUtc: Date;
    createdAtIpAddress: string;
    createdAtUserAgent: string;
    updatedAtUtc: Date;
    updatedAtIpAddress: string;
    updatedAtUserAgent: string;
}; 