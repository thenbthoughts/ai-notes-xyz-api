import { Document, Types } from 'mongoose';

interface IS3FileIndex extends Document {
    userId: Types.ObjectId;
    bucketName: string;
    fileKey: string;
    fileKeyArr: string[];
    filePath: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    contentType?: string;
    isFolder: boolean;
    parentPath: string;
    lastModified?: Date;
    indexedAt: Date;
    textContent?: string;
    isTrashed?: boolean;
    trashedAt?: Date | null;
    originalParentPath?: string;
    versionHistory?: Array<{ content: string; savedAt: Date; size: number }>;
}

export default IS3FileIndex;

