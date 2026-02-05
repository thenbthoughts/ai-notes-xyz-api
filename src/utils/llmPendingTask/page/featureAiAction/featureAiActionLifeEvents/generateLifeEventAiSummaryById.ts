import { ModelLifeEvents } from "../../../../../schema/schemaLifeEvents/SchemaLifeEvents.schema";
import { ModelUser } from "../../../../../schema/schemaUser/SchemaUser.schema";
import { ILifeEvents } from "../../../../../types/typesSchema/typesLifeEvents/SchemaLifeEvents.types";
import { getDefaultLlmModel } from '../../../utils/getDefaultLlmModel';
import fetchLlmUnified from '../../../utils/fetchLlmUnified';


const  generateLifeEventAiSummaryById = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
    try {
        const lifeEventRecords = await ModelLifeEvents.find({
            _id: targetRecordId,
        }) as ILifeEvents[];

        if (!lifeEventRecords || lifeEventRecords.length !== 1) {
            return true;
        }

        const lifeEventFirst = lifeEventRecords[0];

        // Get LLM config using centralized function
        const llmConfig = await getDefaultLlmModel(lifeEventFirst.username);
        if (!llmConfig.featureAiActionsEnabled || !llmConfig.provider) {
            return true; // Skip if no LLM available
        }

        // Check if Life Events AI feature is enabled for this user
        const user = await ModelUser.findOne({ username: lifeEventFirst.username });
        if (!user || !user.featureAiActionsLifeEvents) {
            return true; // Skip if Life Events AI is not enabled for this user
        }

        const updateObj = {
        } as {
            aiSummary?: string;
        };

        let argContent = `Title: ${lifeEventFirst.title}`;
        argContent += `Description: ${lifeEventFirst.description}\n`;
        argContent += `Event Impact: ${lifeEventFirst.eventImpact}\n`;
        if(lifeEventFirst.isStar) {
            argContent += `Is Star: Starred life event\n`;
        }
        if(lifeEventFirst.tags.length >= 1) {
            argContent += `Tags: ${lifeEventFirst.tags.join(', ')}\n`;
        }
        argContent += `Event Date: ${lifeEventFirst.eventDateUtc}\n`;
        argContent += `Event Date Year: ${lifeEventFirst.eventDateYearStr}\n`;
        argContent += `Event Date Year Month: ${lifeEventFirst.eventDateYearMonthStr}\n`;

        let systemPrompt = `From the below content, generate a very detailed summary in simple language.
        Only output the summary, no other text. No markdown.
        Suggest out of the box ideas.
        Suggest few actions that can be taken.
        Suggestions for life events and personal growth.
        Suggest few thoughtful questions that can be asked to the user to gather more information, uncover hidden needs, or improve the contents relevance and impact.`;

        // Use fetchLlmUnified with the config
        const llmResult = await fetchLlmUnified({
            provider: llmConfig.provider as 'openrouter' | 'groq' | 'ollama' | 'openai-compatible',
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: llmConfig.modelName,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: argContent },
            ],
            temperature: 0,
            maxTokens: 1024,
            topP: 1,
            responseFormat: 'text',
        });

        if (llmResult.success && llmResult.content && llmResult.content.length >= 1) {
            updateObj.aiSummary = llmResult.content;
        }

        if (Object.keys(updateObj).length >= 1) {
            await ModelLifeEvents.updateOne(
                { _id: targetRecordId },
                {
                    $set: {
                        ...updateObj,
                    },
                }
            );
        }

        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
};

export default generateLifeEventAiSummaryById;

