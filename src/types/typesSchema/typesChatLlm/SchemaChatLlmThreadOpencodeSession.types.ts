import mongoose, { Document } from 'mongoose';

export interface IChatLlmThreadOpencodeSession extends Document {
    _id: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    username: string;

    workspaceDirectory: string;
    sdkSessionId: string;

    createdAtUtc: Date;
    updatedAtUtc: Date;
}

