import { Document } from 'mongoose';

// Chat Interface
export interface IChatLlmThread extends Document {
    // fields
    threadTitle: string,

    // model info
    aiSummary: string;
    aiTasks: object[];
    tagsAi: string[];

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