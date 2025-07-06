import mongoose, { Document } from 'mongoose';

// Chat Interface
export interface IChatLlmThreadContextReference extends Document {
    // fields
    referenceFrom: string;
    referenceId: mongoose.Schema.Types.ObjectId | null;

    // auth
    username: string;

    // auto
    createdAtUtc: Date;
    createdAtIpAddress: string;
    createdAtUserAgent: string;
    updatedAtUtc: Date;
    updatedAtIpAddress: string;
    updatedAtUserAgent: string;
};