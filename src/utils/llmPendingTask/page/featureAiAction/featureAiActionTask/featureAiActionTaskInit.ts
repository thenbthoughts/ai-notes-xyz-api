import generateFaqBySourceId from "../featureAiActionAll/faq/generateFaqBySourceId";
import generateKeywordsBySourceId from "../featureAiActionAll/keyword/generateKeywordsBySourceId";
import generateTaskAiSummaryById from "./generateTaskAiSummaryById";
import generateTaskAiTagsById from "./generateTaskAiTagsById";
import generateEmbeddingByTaskId from "./generateEmbeddingByTaskId";
import { ModelTask } from "../../../../../schema/schemaTask/SchemaTask.schema";
import { ModelUser } from "../../../../../schema/schemaUser/SchemaUser.schema";
import { reindexDocument } from "../../../../search/reindexGlobalSearch";

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

        // Check if Task AI is enabled for this user
        const taskForUserCheck = await ModelTask.findById(targetRecordId).select('username').lean();
        if (!taskForUserCheck) {
            return true;
        }

        const user = await ModelUser.findOne({
            username: taskForUserCheck.username,
            featureAiActionsEnabled: true,
            featureAiActionsTask: true
        });

        if (!user) {
            console.log('Task AI not enabled for user:', taskForUserCheck.username);
            return true; // Skip AI processing if Task AI is not enabled
        }

        // 1. common - generate faq by source id
        const resultFaq = await generateFaqBySourceId({
            targetRecordId,
            sourceType: 'tasks',
        });
        console.log('resultFaq', resultFaq);

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

        // reindex the document in global search after all AI actions are complete
        const taskRecord = await ModelTask.findById(targetRecordId).select('username').lean();
        if (taskRecord) {
            await reindexDocument({
                reindexDocumentArr: [{
                    collectionName: 'tasks',
                    documentId: targetRecordId,
                }],
            });
        }

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

