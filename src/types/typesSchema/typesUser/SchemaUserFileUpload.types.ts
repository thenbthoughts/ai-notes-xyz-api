import { Document, Types } from 'mongoose';

interface IUserFileUpload extends Document {
    // _id
    _id: Types.ObjectId;
    
    // file upload field (legacy S3 path or GridFS identifier)
    fileUploadPath: string;

    // auth
    userId: Types.ObjectId;

    // GridFS metadata
    storageType?: 'gridfs' | 's3';
    gridFsId?: Types.ObjectId;
    parentEntityId?: string;
    contentType?: string;
    originalName?: string;
    size?: number;
};

export default IUserFileUpload;