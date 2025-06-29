import { Document } from 'mongoose';
import mongoose from 'mongoose';

export interface tsTaskSubList extends Document {
    // Subtask specific fields
    title: string;
    parentTaskId: mongoose.Schema.Types.ObjectId; // Changed to MongoDB ObjectId
    taskCompletedStatus: boolean;
    taskPosition: number;

    // auth
    username: string;

    // auto
    createdAtUtc: Date;
    createdAtIpAddress: string;
    createdAtUserAgent: string;
    updatedAtUtc: Date;
    updatedAtIpAddress: string;
    updatedAtUserAgent: string;
}
