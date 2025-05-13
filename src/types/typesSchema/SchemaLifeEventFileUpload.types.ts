import mongoose, { Document } from 'mongoose';

// LifeEvents
export interface ILifeEventsFileUpload extends Document {
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
    lifeEventId: mongoose.Schema.Types.ObjectId | null;

    // auto
    createdAtUtc: Date;
    createdAtIpAddress: string;
    createdAtUserAgent: string;
    updatedAtUtc: Date;
    updatedAtIpAddress: string;
    updatedAtUserAgent: string;
};