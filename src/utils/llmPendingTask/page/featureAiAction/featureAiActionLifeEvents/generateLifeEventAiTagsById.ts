import { ModelLifeEvents } from "../../../../../schema/schemaLifeEvents/SchemaLifeEvents.schema";
import { ModelUser } from "../../../../../schema/schemaUser/SchemaUser.schema";
import { ILifeEvents } from "../../../../../types/typesSchema/typesLifeEvents/SchemaLifeEvents.types";
import { getDefaultLlmModel } from '../../../utils/getDefaultLlmModel';
import fetchLlmUnified from '../../../utils/fetchLlmUnified';


const  generateLifeEventAiTagsById = async ({
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
            aiTags?: string[];
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

        let systemPrompt = `You are a JSON-based AI assistant specialized in extracting key topics and terms from life event content.
        Your task is to identify and generate a list of significant keywords based on the life event information provided by the user.
        These keywords should represent the main ideas, themes, or topics covered in the life event.

        Output the result in JSON format as follows:
        {
            "keywords": ["keyword 1", "keyword 2", "keyword 3", ...]
        }

        Avoid generic words (e.g., 'the,' 'is,' 'and') and words with no specific relevance.
        Ensure that the keywords are concise and meaningful for quick reference.

        Respond only with the JSON structure.`;

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
            maxTokens: 512,
            topP: 1,
            responseFormat: "json_object",
        });

        if (llmResult.success && llmResult.content) {
            try {
                const parsed = JSON.parse(llmResult.content);
                if (parsed.keywords && Array.isArray(parsed.keywords)) {
                    updateObj.aiTags = parsed.keywords
                        .filter((tag: any) => typeof tag === 'string' && tag.trim().length > 0)
                        .map((tag: string) => tag.trim())
                        .sort((a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase()));
                }
            } catch (parseError) {
                console.error('Failed to parse AI tags response:', parseError);
            }
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

export default generateLifeEventAiTagsById;

