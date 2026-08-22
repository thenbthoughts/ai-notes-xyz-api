import mongoose from 'mongoose';

import { ModelUserApiKey } from '../../schema/schemaUser/SchemaUserApiKey.schema';
import { generateWebhookToken, isWebhookTokenShape } from '../webhook/generateWebhookToken';

export const ensureUserMcpBearerToken = async (
    userId: mongoose.Types.ObjectId | string
): Promise<string> => {
    const uid = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    const existing = await ModelUserApiKey.findOne({ userId: uid })
        .select('mcpBearerToken mcpBearerTokenValid')
        .lean();
    const current =
        existing && typeof existing.mcpBearerToken === 'string' ? existing.mcpBearerToken.trim() : '';
    if (isWebhookTokenShape(current)) {
        if (!existing?.mcpBearerTokenValid) {
            await ModelUserApiKey.updateOne(
                { userId: uid },
                { $set: { mcpBearerTokenValid: true } }
            );
        }
        return current;
    }
    const token = generateWebhookToken(48);
    await ModelUserApiKey.findOneAndUpdate(
        { userId: uid },
        {
            $set: {
                mcpBearerToken: token,
                mcpBearerTokenValid: true,
            },
        },
        { upsert: true, setDefaultsOnInsert: true }
    );
    return token;
};
