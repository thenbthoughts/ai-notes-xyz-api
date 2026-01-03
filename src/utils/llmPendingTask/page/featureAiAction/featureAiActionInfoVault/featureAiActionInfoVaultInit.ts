import generateFaqBySourceId from "../featureAiActionAll/faq/generateFaqBySourceId";
import generateInfoVaultAiSummaryById from "./generateInfoVaultAiSummaryById";
import generateInfoVaultAiTagsById from "./generateInfoVaultAiTagsById";
import generateEmbeddingByInfoVaultId from "./generateEmbeddingByInfoVaultId";

const featureAiActionInfoVaultInit = async ({
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
            sourceType: 'infoVault',
        });

        // 2. infoVault - generate info vault ai summary by id
        const resultInfoVaultAiSummary = await generateInfoVaultAiSummaryById({
            targetRecordId,
        });
        console.log('resultInfoVaultAiSummary', resultInfoVaultAiSummary);

        // 3. infoVault - generate info vault ai tags by id
        const resultInfoVaultAiTags = await generateInfoVaultAiTagsById({
            targetRecordId,
        });
        console.log('resultInfoVaultAiTags', resultInfoVaultAiTags);

        // 4. infoVault - generate embedding by info vault id
        const resultEmbedding = await generateEmbeddingByInfoVaultId({
            targetRecordId,
        });
        console.log('resultEmbedding', resultEmbedding);

        // return result of all feature ai actions
        let finalReturn = true;
        if (!resultFaq) {
            finalReturn = false;
        }
        if (!resultInfoVaultAiSummary) {
            finalReturn = false;
        }
        if (!resultInfoVaultAiTags) {
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

export default featureAiActionInfoVaultInit;

