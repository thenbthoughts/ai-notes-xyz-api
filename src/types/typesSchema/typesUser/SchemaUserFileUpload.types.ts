import { Document } from 'mongoose';

interface IUserFileUpload extends Document {
    // file uplopd field
    fileUploadPath: string;

    // auth
    username: string;
};

export default IUserFileUpload;