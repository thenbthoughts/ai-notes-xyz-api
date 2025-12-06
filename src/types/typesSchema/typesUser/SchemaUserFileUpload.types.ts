import { Document, ObjectId } from 'mongoose';

interface IUserFileUpload extends Document {
    // _id
    _id: ObjectId;
    
    // file uplopd field
    fileUploadPath: string;

    // auth
    username: string;
};

export default IUserFileUpload;