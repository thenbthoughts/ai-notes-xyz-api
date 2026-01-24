import mongoose from "mongoose";

import { ModelChatLlmThread } from "../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema";

import autoContextSelectByMethodSearch from "./autoContextSelect/autoContextSelectByMethodSearch";

const selectAutoContextByThreadId = async ({
    threadId,
    username,
}: {
    threadId: mongoose.Types.ObjectId;
    username: string;
}) : Promise<{
    success: boolean;
    errorReason: string;
    data: {
        keywords: string[];
        insertedContextReferences: number;
    };
}> => {
    try {
        // does thread belong to user
        const thread = await ModelChatLlmThread.findById(threadId);
        if (!thread) {
            return {
                success: false,
                errorReason: 'Thread not found',
                data: {
                    keywords: [],
                    insertedContextReferences: 0,
                }
            };
        }
        if (thread.username !== username) {
            return {
                success: false,
                errorReason: 'Thread does not belong to user',
                data: {
                    keywords: [],
                    insertedContextReferences: 0,
                }
            };
        }

        // by method search
        const result = await autoContextSelectByMethodSearch({
            threadId,
        });

        // TODO: by method vector db

        return {
            success: result.success,
            errorReason: result.success ? '' : 'Failed to select auto context by method search',
            data: result.data,
        };
    } catch (error) {
        console.error('❌ Error in selectAutoContextByThreadId:', error);
        return {
            success: false,
            errorReason: 'Internal server error',
            data: {
                keywords: [],
                insertedContextReferences: 0,
            }
        };
    }
}

export default selectAutoContextByThreadId;