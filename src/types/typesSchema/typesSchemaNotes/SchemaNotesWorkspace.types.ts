import { Document, Types } from 'mongoose';

// Notes Workspace
export interface INotesWorkspace extends Document {
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