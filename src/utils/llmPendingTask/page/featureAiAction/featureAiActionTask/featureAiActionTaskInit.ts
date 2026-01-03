import generateFaqBySourceId from "../featureAiActionAll/faq/generateFaqBySourceId";
import generateKeywordsBySourceId from "../featureAiActionAll/keyword/generateKeywordsBySourceId";
import generateTaskAiSummaryById from "./generateTaskAiSummaryById";
import generateTaskAiTagsById from "./generateTaskAiTagsById";
import generateEmbeddingByTaskId from "./generateEmbeddingByTaskId";

const featureAiActionTaskInit = async ({
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
            sourceType: 'task',
        });

        // 2. task - generate task ai summary by id
        const resultTaskAiSummary = await generateTaskAiSummaryById({
            targetRecordId,
        });
        console.log('resultTaskAiSummary', resultTaskAiSummary);

        // 3. task - generate task ai tags by id
        const resultTaskAiTags = await generateTaskAiTagsById({
            targetRecordId,
        });
        console.log('resultTaskAiTags', resultTaskAiTags);

        // 4. task - generate embedding by task id
        const resultEmbedding = await generateEmbeddingByTaskId({
            targetRecordId,
        });
        console.log('resultEmbedding', resultEmbedding);

        // 5. common - generate keywords by source id
        const resultKeywords = await generateKeywordsBySourceId({
            targetRecordId,
        });
        console.log('resultKeywords', resultKeywords);

        // return result of all feature ai actions
        let finalReturn = true;
        if (!resultFaq) {
            finalReturn = false;
        }
        if (!resultTaskAiSummary) {
            finalReturn = false;
        }
        if (!resultTaskAiTags) {
            finalReturn = false;
        }
        if (!resultEmbedding) {
            finalReturn = false;
        }
        if (!resultKeywords) {
            finalReturn = false;
        }

        return finalReturn;
    } catch (error) {
        console.error(error);
        return false;
    }
};

export default featureAiActionTaskInit;

