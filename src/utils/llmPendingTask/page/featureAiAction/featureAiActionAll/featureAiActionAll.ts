import generateFaqBySourceId from "./faq/generateFaqBySourceId";

const featureAiActionAll = async ({
    targetRecordId,
    sourceType,
}: {
    targetRecordId: string | null;
    sourceType: string;
}) => {
    try {
        if (!targetRecordId) {
            return true;
        }

        console.log('targetRecordId', targetRecordId);

        const resultFaq = await generateFaqBySourceId({
            targetRecordId,
            sourceType,
        });
        console.log('resultFaq', resultFaq);

        return true; // TODO: return result of all feature AI actions
    } catch (error) {
        console.error(error);
        return false;
    }
};

export default featureAiActionAll;