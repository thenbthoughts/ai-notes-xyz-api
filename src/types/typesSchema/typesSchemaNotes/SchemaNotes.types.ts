import mongoose, { Document } from 'mongoose';

// Notes
export interface INotes extends Document {
    // identification
    username: string;
    notesWorkspaceId: mongoose.Schema.Types.ObjectId | null;

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