import mongoose, { Document } from 'mongoose';

// User Memory Interface
export interface IUserMemory extends Document {
    // identification
    _id: mongoose.Types.ObjectId;

    // fields
    username: string;
    content: string;
    isPermanent: boolean;

    // auto
    createdAtUtc: Date | null;
    createdAtIpAddress: string;
    createdAtUserAgent: string;
    updatedAtUtc: Date | null;
    updatedAtIpAddress: string;
    updatedAtUserAgent: string;
}
