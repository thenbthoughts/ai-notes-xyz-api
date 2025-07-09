import mongoose, { Document } from 'mongoose';

// Chat Interface
export interface IChatLlmThreadContextReference extends Document {
    // fields
    threadId: mongoose.Types.ObjectId | null;
    referenceFrom: string;
    referenceId: mongoose.Types.ObjectId | null;
    isAddedByAi: boolean;

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