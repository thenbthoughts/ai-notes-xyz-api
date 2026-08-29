import { Document, Types } from 'mongoose';

// Task Workspace
export interface ITaskWorkspace extends Document {
    // identification
    userId: Types.ObjectId;

    // fields
    title: string;
    description: string;
    isStar: boolean;
    tags: string[];

    // ai
    aiSummary: string;
    aiTags: string[];
    aiSuggestions: string;

    // auto
    createdAtUtc: Date;
    createdAtIpAddress: string;
    createdAtUserAgent: string;
    updatedAtUtc: Date;
    updatedAtIpAddress: string;
    updatedAtUserAgent: string;
};