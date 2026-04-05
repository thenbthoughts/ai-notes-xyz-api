import mongoose, { Schema } from 'mongoose';
import IUserTelegramConversationCache from '../../types/typesSchema/typesUser/SchemaUserTelegramConversationCache.types';

const chatEntrySchema = new Schema(
    {
        chatId: { type: String, required: true },
        messageThreadId: { type: Number, default: null },
        label: { type: String, required: true },
        type: { type: String, required: true },
    },
    { _id: false }
);

const userTelegramConversationCacheSchema = new Schema<IUserTelegramConversationCache>(
    {
        username: { type: String, required: true, unique: true, lowercase: true },
        chats: { type: [chatEntrySchema], default: [] },
        updatedAtUtc: { type: Date, default: Date.now },
    },
    { collection: 'userTelegramConversationCache' }
);

const ModelUserTelegramConversationCache = mongoose.model<IUserTelegramConversationCache>(
    'userTelegramConversationCache',
    userTelegramConversationCacheSchema,
    'userTelegramConversationCache'
);

export { ModelUserTelegramConversationCache };
