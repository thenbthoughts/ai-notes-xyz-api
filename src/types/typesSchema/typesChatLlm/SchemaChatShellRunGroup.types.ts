import mongoose, { Document } from 'mongoose';

export interface IChatShellRunGroup extends Document {
    _id: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    username: string;
    status: 'pending' | 'running' | 'completed' | 'error';
    errorReason: string;
    createdAtUtc: Date | null;
    updatedAtUtc: Date | null;
}
