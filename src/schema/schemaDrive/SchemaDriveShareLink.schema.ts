import mongoose, { Schema } from 'mongoose';

interface IDriveShareLink extends mongoose.Document {
    userId: mongoose.Types.ObjectId;
    bucketName: string;
    fileKey: string;
    token: string;
    expiresAt: Date;
    createdAt: Date;
}

const driveShareLinkSchema = new Schema<IDriveShareLink>({
    userId: { type: Schema.Types.ObjectId, ref: 'user', required: true, index: true },
    bucketName: { type: String, required: true },
    fileKey: { type: String, required: true },
    token: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
    createdAt: { type: Date, default: Date.now },
});

driveShareLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const ModelDriveShareLink = mongoose.model<IDriveShareLink>('driveShareLink', driveShareLinkSchema, 'driveShareLink');

export { ModelDriveShareLink };
export type { IDriveShareLink };
