import generateFaqBySourceId from "../featureAiActionAll/faq/generateFaqBySourceId";
import generateKeywordsBySourceId from "../featureAiActionAll/keyword/generateKeywordsBySourceId";
import generateLifeEventAiSummaryById from "./generateLifeEventAiSummaryById";
import generateLifeEventAiTagsById from "./generateLifeEventAiTagsById";
import generateLifeEventAiCategoryById from "./generateLifeEventAiCategoryById";
import generateEmbeddingByLifeEventsId from "./generateEmbeddingByLifeEventsId";

const featureAiActionLifeEventsInit = async ({
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
            sourceType: 'lifeEvents',
        });

        // 2. lifeEvents - generate life events ai summary by id
        const resultLifeEventsAiSummary = await generateLifeEventAiSummaryById({
            targetRecordId,
        });
        console.log('resultLifeEventsAiSummary', resultLifeEventsAiSummary);

        // 3. lifeEvents - generate life events ai tags by id
        const resultLifeEventsAiTags = await generateLifeEventAiTagsById({
            targetRecordId,
        });
        console.log('resultLifeEventsAiTags', resultLifeEventsAiTags);

        // 4. lifeEvents - generate life events ai category by id
        const resultLifeEventsAiCategory = await generateLifeEventAiCategoryById({
            targetRecordId,
        });
        console.log('resultLifeEventsAiCategory', resultLifeEventsAiCategory);

        // 5. lifeEvents - generate embedding by life events id
        const resultEmbedding = await generateEmbeddingByLifeEventsId({
            targetRecordId,
        });
        console.log('resultEmbedding', resultEmbedding);

        // 6. common - generate keywords by source id
        const resultKeywords = await generateKeywordsBySourceId({
            targetRecordId,
        });
        console.log('resultKeywords', resultKeywords);

        // return result of all feature ai actions
        let finalReturn = true;
        if (!resultFaq) {
            finalReturn = false;
        }
        if (!resultLifeEventsAiSummary) {
            finalReturn = false;
        }
        if (!resultLifeEventsAiTags) {
            finalReturn = false;
        }
        if (!resultLifeEventsAiCategory) {
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

export default featureAiActionLifeEventsInit;

