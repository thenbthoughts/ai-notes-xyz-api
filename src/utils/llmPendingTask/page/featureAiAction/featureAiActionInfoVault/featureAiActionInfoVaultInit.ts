import generateFaqBySourceId from "../featureAiActionAll/faq/generateFaqBySourceId";
import generateKeywordsBySourceId from "../featureAiActionAll/keyword/generateKeywordsBySourceId";
import generateInfoVaultAiSummaryById from "./generateInfoVaultAiSummaryById";
import generateInfoVaultAiTagsById from "./generateInfoVaultAiTagsById";
import generateEmbeddingByInfoVaultId from "./generateEmbeddingByInfoVaultId";
import { ModelInfoVault } from "../../../../../schema/schemaInfoVault/SchemaInfoVault.schema";
import { ModelUser } from "../../../../../schema/schemaUser/SchemaUser.schema";
import { reindexDocument } from "../../../../search/reindexGlobalSearch";

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

        // Check if Info Vault AI is enabled for this user
        const infoVaultForUserCheck = await ModelInfoVault.findById(targetRecordId).select('username').lean();
        if (!infoVaultForUserCheck) {
            return true;
        }

        const user = await ModelUser.findOne({
            username: infoVaultForUserCheck.username,
            featureAiActionsEnabled: true,
            featureAiActionsInfoVault: true
        });

        if (!user) {
            console.log('Info Vault AI not enabled for user:', infoVaultForUserCheck.username);
            return true; // Skip AI processing if Info Vault AI is not enabled
        }

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

        // 5. common - generate keywords by source id
        const resultKeywords = await generateKeywordsBySourceId({
            targetRecordId,
        });
        console.log('resultKeywords', resultKeywords);

        // reindex the document in global search after all AI actions are complete
        const infoVaultRecord = await ModelInfoVault.findById(targetRecordId).select('username').lean();
        if (infoVaultRecord) {
            await reindexDocument({
                reindexDocumentArr: [{
                    collectionName: 'infoVault',
                    documentId: targetRecordId,
                }],
            });
        }

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
        if (!resultKeywords) {
            finalReturn = false;
        }

        return finalReturn;
    } catch (error) {
        console.error(error);
        return false;
    }
};

export default featureAiActionInfoVaultInit;

