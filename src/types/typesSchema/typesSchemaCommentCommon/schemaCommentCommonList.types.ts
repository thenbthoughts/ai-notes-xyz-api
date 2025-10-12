import mongoose, { Document } from 'mongoose';

export interface ISchemaCommentCommon extends Document {
    // Comment specific fields
    commentText: string;
    isAi: boolean;

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

    // auth
    username: string;

    // Reference to the notes, task, lifeEvent, infoVault
    commentType: string; // notes, task, lifeEvent, infoVault
    entityId: mongoose.Schema.Types.ObjectId;

    // auto
    createdAtUtc: Date;
    createdAtIpAddress: string;
    createdAtUserAgent: string;
    updatedAtUtc: Date;
    updatedAtIpAddress: string;
    updatedAtUserAgent: string;
}
