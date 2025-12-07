import { Document, ObjectId } from 'mongoose';

interface IUserFileUpload extends Document {
    // _id
    _id: ObjectId;
    
    // file upload field (legacy S3 path or GridFS identifier)
    fileUploadPath: string;

    // auth
    username: string;

    // GridFS metadata
    storageType?: 'gridfs' | 's3';
    gridFsId?: ObjectId;
    parentEntityId?: string;
    contentType?: string;
    originalName?: string;
    size?: number;
};

export default IUserFileUpload;