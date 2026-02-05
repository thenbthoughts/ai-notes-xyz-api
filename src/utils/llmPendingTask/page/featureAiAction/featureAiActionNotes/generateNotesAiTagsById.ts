import { NodeHtmlMarkdown } from 'node-html-markdown';
import { ModelNotes } from "../../../../../schema/schemaNotes/SchemaNotes.schema";
import { ModelUser } from "../../../../../schema/schemaUser/SchemaUser.schema";
import { INotes } from "../../../../../types/typesSchema/typesSchemaNotes/SchemaNotes.types";
import { getDefaultLlmModel } from '../../../utils/getDefaultLlmModel';
import fetchLlmUnified from '../../../utils/fetchLlmUnified';

const  generateNotesAiTagsById = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
    try {
        const notesRecords = await ModelNotes.find({
            _id: targetRecordId,
        }) as INotes[];

        if (!notesRecords || notesRecords.length !== 1) {
            return true;
        }

        const notesFirst = notesRecords[0];

        // Get LLM config using centralized function
        const llmConfig = await getDefaultLlmModel(notesFirst.username);
        if (!llmConfig.featureAiActionsEnabled || !llmConfig.provider) {
            return true; // Skip if no LLM available
        }

        // Check if Notes AI feature is enabled for this user
        const user = await ModelUser.findOne({ username: notesFirst.username });
        if (!user || !user.featureAiActionsNotes) {
            return true; // Skip if Notes AI is not enabled for this user
        }

        const updateObj = {
        } as {
            aiTags?: string[];
        };

        let argContent = `Title: ${notesFirst.title}`;

        if(notesFirst.description.length >= 1) {
            const markdownContent = NodeHtmlMarkdown.translate(notesFirst.description);
            argContent += `Description: ${markdownContent}\n`;
        }
        if(notesFirst.isStar) {
            argContent += `Is Star: Starred note\n`;
        }
        if(notesFirst.tags.length >= 1) {
            argContent += `Tags: ${notesFirst.tags.join(', ')}\n`;
        }

        let systemPrompt = `You are a JSON-based AI assistant specialized in extracting key topics and terms from user notes.
        Your task is to identify and generate a list of significant keywords based on the content provided by the user.
        These keywords should represent the main ideas, themes, or topics covered in the user's input.

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
            await ModelNotes.updateOne(
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

export default generateNotesAiTagsById;