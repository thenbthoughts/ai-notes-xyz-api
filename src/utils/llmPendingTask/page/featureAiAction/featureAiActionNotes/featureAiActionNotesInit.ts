import generateFaqBySourceId from "../featureAiActionAll/faq/generateFaqBySourceId";
import generateNotesAiSummaryById from "./generateNotesAiSummaryById";
import generateNotesAiTagsById from "./generateNotesAiTagsById";
import generateEmbeddingByNotesId from "./generateEmbeddingByNotesId";

const featureAiActionNotesInit = async ({
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
            sourceType: 'notes',
        });

        // 2. notes - generate notes ai summary by id
        const resultNotesAiSummary = await generateNotesAiSummaryById({
            targetRecordId,
        });
        console.log('resultNotesAiSummary', resultNotesAiSummary);

        // 3. notes - generate notes ai tags by id
        const resultNotesAiTags = await generateNotesAiTagsById({
            targetRecordId,
        });
        console.log('resultNotesAiTags', resultNotesAiTags);

        // 4. notes - generate embedding by notes id
        const resultEmbedding = await generateEmbeddingByNotesId({
            targetRecordId,
        });
        console.log('resultEmbedding', resultEmbedding);

        // return result of all feature ai actions
        let finalReturn = true;
        if (!resultFaq) {
            finalReturn = false;
        }
        if (!resultNotesAiSummary) {
            finalReturn = false;
        }
        if (!resultNotesAiTags) {
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

export default featureAiActionNotesInit;