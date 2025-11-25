import { Document } from 'mongoose';

interface IUserS3Bucket extends Document {
    username: string;
    bucketName: string;
    endpoint: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    prefix?: string;
    isActive: boolean;
    createdAtUtc?: Date;
    updatedAtUtc?: Date;
}

export default IUserS3Bucket;

