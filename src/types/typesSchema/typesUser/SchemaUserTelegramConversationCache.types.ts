import { Document } from 'mongoose';

export interface ITelegramCachedChat {
    /** Telegram chat id (supergroup, private, channel, …) */
    chatId: string;
    /** Forum supergroup topic id — required when posting to a specific topic */
    messageThreadId?: number | null;
    label: string;
    type: string;
}

interface IUserTelegramConversationCache extends Document {
    username: string;
    chats: ITelegramCachedChat[];
    updatedAtUtc: Date;
}

export default IUserTelegramConversationCache;
