import { Document } from 'mongoose';

// User Interface
interface IUserNotification extends Document {
    username: string;

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