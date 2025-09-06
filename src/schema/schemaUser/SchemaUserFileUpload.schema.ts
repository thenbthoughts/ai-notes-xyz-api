import mongoose, { Schema } from 'mongoose';
import IUserFileUpload from '../../types/typesSchema/typesUser/SchemaUserFileUpload.types';

// User file upload schema
const userFileUploadSchema = new Schema<IUserFileUpload>({
    username: { type: String, required: true, default: '', index: true },

    // file upload field
    fileUploadPath: { type: String, required: true, default: '', index: true },
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