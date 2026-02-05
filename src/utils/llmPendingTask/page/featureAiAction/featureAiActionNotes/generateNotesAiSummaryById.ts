import { NodeHtmlMarkdown } from 'node-html-markdown';
import { ModelNotes } from "../../../../../schema/schemaNotes/SchemaNotes.schema";
import { ModelUser } from "../../../../../schema/schemaUser/SchemaUser.schema";
import { INotes } from "../../../../../types/typesSchema/typesSchemaNotes/SchemaNotes.types";
import { getDefaultLlmModel } from '../../../utils/getDefaultLlmModel';
import fetchLlmUnified from '../../../utils/fetchLlmUnified';


const  generateNotesAiSummaryById = async ({
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
            aiSummary?: string;
        };

        let argContent = `Title: ${notesFirst.title}`;
        if(notesFirst.description.length >= 1) {
            const markdownContent = NodeHtmlMarkdown.translate(notesFirst.description);
            argContent += `Description: ${markdownContent}\n`;
        }
        if(notesFirst.isStar) {
            argContent += `Is Star: Starred life event\n`;
        }
        if(notesFirst.tags.length >= 1) {
            argContent += `Tags: ${notesFirst.tags.join(', ')}\n`;
        }

        let systemPrompt = `From the below content, generate a very detailed summary in simple language.
        Only output the summary, no other text. No markdown.
        Suggest out of the box ideas.
        Suggest few actions that can be taken.
        Suggestions for life.
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
        });

        if (llmResult.success && llmResult.content && llmResult.content.length >= 1) {
            updateObj.aiSummary = llmResult.content;
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

export default generateNotesAiSummaryById;