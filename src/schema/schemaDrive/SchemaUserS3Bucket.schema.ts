import mongoose, { Schema } from 'mongoose';
import IUserS3Bucket from '../../types/typesSchema/typesDrive/SchemaUserS3Bucket.types';

const userS3BucketSchema = new Schema<IUserS3Bucket>({
    username: { type: String, required: true, default: '', index: true },
    bucketName: { type: String, required: true, default: '' },
    endpoint: { type: String, required: true, default: '' },
    region: { type: String, required: true, default: '' },
    accessKeyId: { type: String, required: true, default: '' },
    secretAccessKey: { type: String, required: true, default: '' },
    prefix: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    createdAtUtc: { type: Date, default: Date.now },
    updatedAtUtc: { type: Date, default: Date.now },
});

const ModelUserS3Bucket = mongoose.model<IUserS3Bucket>(
    'userS3Bucket',
    userS3BucketSchema,
    'userS3Bucket'
);

export {
    ModelUserS3Bucket
};

