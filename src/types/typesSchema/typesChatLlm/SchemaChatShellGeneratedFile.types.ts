import mongoose, { Document } from 'mongoose';

export interface IChatShellGeneratedFile extends Document {
    _id: mongoose.Types.ObjectId;
    chatShellRunGroupId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    todoId: mongoose.Types.ObjectId | null;
    relativePath: string;
    /** GridFS id or S3 key after copy into app storage */
    storedFileUrl: string;
    fileName: string;
    mimeType: string;
    summary: string;
    createdAtUtc: Date | null;
}
