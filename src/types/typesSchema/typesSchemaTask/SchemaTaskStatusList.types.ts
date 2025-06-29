import mongoose, { Document } from 'mongoose';

export interface tsTaskStatusList extends Document {
    // fields
    statusTitle: string;
    listPosition: number;

    // identification
    username: string;

    // task workspace id
    taskWorkspaceId: mongoose.Types.ObjectId | null;
}
