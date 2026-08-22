import mongoose from 'mongoose';

import { ModelUserApiKey } from '../../schema/schemaUser/SchemaUserApiKey.schema';
import { generateWebhookToken, isWebhookTokenShape } from './generateWebhookToken';

export const ensureUserWebhookToken = async (
    userId: mongoose.Types.ObjectId | string
): Promise<string> => {
    const uid = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    const existing = await ModelUserApiKey.findOne({ userId: uid }).select('webhookToken').lean();
    const current = existing && typeof existing.webhookToken === 'string' ? existing.webhookToken.trim() : '';
    if (isWebhookTokenShape(current)) {
        return current;
    }
    const token = generateWebhookToken(48);
    await ModelUserApiKey.findOneAndUpdate(
        { userId: uid },
        {
            $set: {
                webhookToken: token,
                webhookTokenValid: true,
            },
        },
        { upsert: true, setDefaultsOnInsert: true }
    );
    return token;
};
