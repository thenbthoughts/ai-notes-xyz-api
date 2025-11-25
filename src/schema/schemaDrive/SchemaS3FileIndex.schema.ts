import mongoose, { Schema } from 'mongoose';
import IS3FileIndex from '../../types/typesSchema/typesDrive/SchemaS3FileIndex.types';

const s3FileIndexSchema = new Schema<IS3FileIndex>({
    username: { type: String, required: true, default: '', index: true },
    bucketName: { type: String, required: true, default: '', index: true },
    fileKey: { type: String, required: true, default: '', index: true },
    fileKeyArr: { type: [String], required: true, default: [] },
    filePath: { type: String, required: true, default: '', index: true },
    fileName: { type: String, required: true, default: '' },
    fileType: { type: String, required: true, default: '' },
    fileSize: { type: Number, default: 0 },
    contentType: { type: String, default: '' },
    isFolder: { type: Boolean, default: false, index: true },
    parentPath: { type: String, required: true, default: '', index: true },
    lastModified: { type: Date, default: null },
    indexedAt: { type: Date, default: Date.now, index: true },
});

// Compound indexes for efficient queries
s3FileIndexSchema.index({ username: 1, bucketName: 1, parentPath: 1 });
s3FileIndexSchema.index({ username: 1, bucketName: 1, isFolder: 1 });

const ModelS3FileIndex = mongoose.model<IS3FileIndex>(
    's3FileIndex',
    s3FileIndexSchema,
    's3FileIndex'
);

export {
    ModelS3FileIndex
};

