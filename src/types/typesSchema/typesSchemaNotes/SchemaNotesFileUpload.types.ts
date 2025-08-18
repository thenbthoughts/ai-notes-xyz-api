import mongoose, { Document } from 'mongoose';

// Notes
export interface INotesFileUpload extends Document {
    // file fields
    fileType: string;
    fileUrl: string;
    fileTitle: string;
    fileDescription: string;

    // ai
    aiTitle: string;
    aiSummaryContext: string;
    aiSummarySpecific: string;
    aiTags: string[];

    // identification
    username: string;
    noteId: mongoose.Schema.Types.ObjectId | null;

    // auto
    createdAtUtc: Date;
    createdAtIpAddress: string;
    createdAtUserAgent: string;
    updatedAtUtc: Date;
    updatedAtIpAddress: string;
    updatedAtUserAgent: string;
};