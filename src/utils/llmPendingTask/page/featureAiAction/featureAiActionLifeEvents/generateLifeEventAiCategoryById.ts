import { ModelLifeEvents } from "../../../../../schema/schemaLifeEvents/SchemaLifeEvents.schema";
import { ModelUser } from "../../../../../schema/schemaUser/SchemaUser.schema";
import { ILifeEvents } from "../../../../../types/typesSchema/typesLifeEvents/SchemaLifeEvents.types";
import lifeCategoriesAiJson from "../../../../../routes/lifeEvents/lifeEventsCrud/LifeCategoriesAiJson";
import { getDefaultLlmModel } from '../../../utils/getDefaultLlmModel';
import fetchLlmUnified from '../../../utils/fetchLlmUnified';


const generateLifeEventAiCategoryById = async ({
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
            aiCategory: 'Other',
            aiSubCategory: 'Other',
        } as {
            aiCategory: string;
            aiSubCategory: string;
        };

        let argContent = `Title: ${lifeEventFirst.title}`;
        argContent += `Description: ${lifeEventFirst.description}\n`;
        argContent += `Event Impact: ${lifeEventFirst.eventImpact}\n`;
        if (lifeEventFirst.isStar) {
            argContent += `Is Star: Starred life event\n`;
        }
        if (lifeEventFirst.tags.length >= 1) {
            argContent += `Tags: ${lifeEventFirst.tags.join(', ')}\n`;
        }
        argContent += `Event Date: ${lifeEventFirst.eventDateUtc}\n`;
        argContent += `Event Date Year: ${lifeEventFirst.eventDateYearStr}\n`;
        argContent += `Event Date Year Month: ${lifeEventFirst.eventDateYearMonthStr}\n`;

        // Create system prompt with available categories
        const categoriesList = lifeCategoriesAiJson.map(category => `${category.name}: ${category.subcategory.join(', ')}`).join('\n');

        let systemPrompt = `You are an AI assistant specialized in categorizing life events.
        Based on the life event description provided, classify it into the most appropriate category and subcategory.

        Available categories and subcategories:
        ${categoriesList}

        Output the result in JSON format as follows:
        {
            "category": "Category Name",
            "subcategory": "Subcategory Name"
        }

        If no category fits well, use "Other" for both category and subcategory.
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
                if (parsed.category && parsed.subcategory) {
                    updateObj.aiCategory = parsed.category;
                    updateObj.aiSubCategory = parsed.subcategory;
                }
            } catch (parseError) {
                console.error('Failed to parse AI category response:', parseError);
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

export default generateLifeEventAiCategoryById;

