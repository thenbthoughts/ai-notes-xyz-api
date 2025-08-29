import mongoose, { Document } from 'mongoose';

export interface tsNotesCommentList extends Document {
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

    // Reference to the notes
    notesId: mongoose.Schema.Types.ObjectId;

    // auto
    createdAtUtc: Date;
    createdAtIpAddress: string;
    createdAtUserAgent: string;
    updatedAtUtc: Date;
    updatedAtIpAddress: string;
    updatedAtUserAgent: string;
}
