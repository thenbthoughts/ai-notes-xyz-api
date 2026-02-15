import mongoose from "mongoose";
import { ModelChatLlm } from "../../../../../schema/schemaChatLlm/SchemaChatLlm.schema";
import { IChatLlm } from "../../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types";

/**
 * Step 1: Get conversation messages for the thread
 */
export const step1GetConversation = async ({
    threadId,
    username,
}: {
    threadId: mongoose.Types.ObjectId;
    username: string;
}): Promise<IChatLlm[]> => {
    try {
        console.log(`[Get Conversation] Fetching conversation for thread ${threadId}`);

        // Get conversation messages for this thread, ordered by creation time
        const conversationList = await ModelChatLlm.find({
            threadId,
            username,
        }).sort({ createdAtUtc: 1 }); // Sort ascending to get chronological order

        console.log(`[Get Conversation] Found ${conversationList.length} messages`);
        return conversationList;
    } catch (error) {
        console.error(`❌ Error in step1GetConversation (thread ${threadId}):`, error);
        return [];
    }
};