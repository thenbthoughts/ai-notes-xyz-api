import { Document, Types } from 'mongoose';

// User Interface
interface IUserNotification extends Document {
    userId: Types.ObjectId;

    // info
    smtpTo: string;
    subject: string;
    text: string;
    html: string;
    channel?: 'email' | 'telegram';
    telegramChatId?: string;

    // createdAt
    createdAtUtc: Date;
}

export default IUserNotification;