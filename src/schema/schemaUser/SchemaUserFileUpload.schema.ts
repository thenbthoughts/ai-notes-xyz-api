import mongoose, { Schema } from 'mongoose';
import IUserFileUpload from '../../types/typesSchema/typesUser/SchemaUserFileUpload.types';

// User file upload schema
const userFileUploadSchema = new Schema<IUserFileUpload>({
    username: { type: String, required: true, default: '', index: true },

    // file upload field (legacy S3 path or GridFS identifier)
    fileUploadPath: { type: String, required: true, default: '', index: true },

    // GridFS metadata
    storageType: { type: String, enum: ['gridfs', 's3'], default: 'gridfs', index: true },
    gridFsId: { type: Schema.Types.ObjectId, index: true },
    parentEntityId: { type: String, index: true },
    contentType: { type: String },
    originalName: { type: String },
    size: { type: Number },
});

// User Model
const ModelUserFileUpload = mongoose.model<IUserFileUpload>(
    'userFileUpload',
    userFileUploadSchema,
    'userFileUpload'
);

export {
    ModelUserFileUpload
};