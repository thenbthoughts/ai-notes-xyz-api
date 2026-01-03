import generateFaqBySourceId from "../featureAiActionAll/faq/generateFaqBySourceId";
import generateChatThreadAiSummaryById from "./generateChatThreadAiSummaryById";
import generateChatThreadAiTagsById from "./generateChatThreadAiTagsById";
import generateChatThreadAiTitleById from "./generateChatThreadAiTitleById";
import generateEmbeddingByChatThreadId from "./generateEmbeddingByChatThreadId";

const featureAiActionChatThreadInit = async ({
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
            sourceType: 'chatThread',
        });

        // 2. chatThread - generate chat thread ai summary by id
        const resultChatThreadAiSummary = await generateChatThreadAiSummaryById({
            targetRecordId,
        });
        console.log('resultChatThreadAiSummary', resultChatThreadAiSummary);

        // 3. chatThread - generate chat thread ai tags by id
        const resultChatThreadAiTags = await generateChatThreadAiTagsById({
            targetRecordId,
        });
        console.log('resultChatThreadAiTags', resultChatThreadAiTags);

        // 4. chatThread - generate chat thread ai title by id
        const resultChatThreadAiTitle = await generateChatThreadAiTitleById({
            targetRecordId,
        });
        console.log('resultChatThreadAiTitle', resultChatThreadAiTitle);

        // 5. chatThread - generate embedding by chat thread id
        const resultEmbedding = await generateEmbeddingByChatThreadId({
            targetRecordId,
        });
        console.log('resultEmbedding', resultEmbedding);

        // return result of all feature ai actions
        let finalReturn = true;
        if (!resultFaq) {
            finalReturn = false;
        }
        if (!resultChatThreadAiSummary) {
            finalReturn = false;
        }
        if (!resultChatThreadAiTags) {
            finalReturn = false;
        }
        if (!resultChatThreadAiTitle) {
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

export default featureAiActionChatThreadInit;

