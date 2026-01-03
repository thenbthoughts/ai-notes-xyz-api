import generateFaqBySourceId from "../featureAiActionAll/faq/generateFaqBySourceId";
import generateChatMessageAiSummaryById from "./generateChatMessageAiSummaryById";
import generateChatMessageAiTagsById from "./generateChatMessageAiTagsById";
import generateEmbeddingByChatMessageId from "./generateEmbeddingByChatMessageId";

const featureAiActionChatMessageInit = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
    try {
        if (!targetRecordId) {
            return true;
        }

        console.log('targetRecordId', targetRecordId);

        // 1. common - generate faq by source id
        const resultFaq = await generateFaqBySourceId({
            targetRecordId,
            sourceType: 'chatMessage',
        });

        // 2. chatMessage - generate chat message ai summary by id
        const resultChatMessageAiSummary = await generateChatMessageAiSummaryById({
            targetRecordId,
        });
        console.log('resultChatMessageAiSummary', resultChatMessageAiSummary);

        // 3. chatMessage - generate chat message ai tags by id
        const resultChatMessageAiTags = await generateChatMessageAiTagsById({
            targetRecordId,
        });
        console.log('resultChatMessageAiTags', resultChatMessageAiTags);

        // 4. chatMessage - generate embedding by chat message id
        const resultEmbedding = await generateEmbeddingByChatMessageId({
            targetRecordId,
        });
        console.log('resultEmbedding', resultEmbedding);

        // return result of all feature ai actions
        let finalReturn = true;
        if (!resultFaq) {
            finalReturn = false;
        }
        if (!resultChatMessageAiSummary) {
            finalReturn = false;
        }
        if (!resultChatMessageAiTags) {
            finalReturn = false;
        }
        if (!resultEmbedding) {
            finalReturn = false;
        }

        return finalReturn;
    } catch (error) {
        console.error(error);
        return false;
    }
};

export default featureAiActionChatMessageInit;

