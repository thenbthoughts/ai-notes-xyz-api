import { Document } from 'mongoose';

// User Interface
interface IUserNotification extends Document {
    username: string;

    // info
    smtpTo: string;
    subject: string;
    text: string;
    html: string;
    
    // createdAt
    createdAtUtc: Date;
}

export default IUserNotification;