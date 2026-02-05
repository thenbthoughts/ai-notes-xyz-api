import { ModelChatLlm } from "../../../../../schema/schemaChatLlm/SchemaChatLlm.schema";
import { ModelUser } from "../../../../../schema/schemaUser/SchemaUser.schema";
import { IChatLlm } from "../../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types";
import { getDefaultLlmModel } from '../../../utils/getDefaultLlmModel';
import fetchLlmUnified from '../../../utils/fetchLlmUnified';
import { Message } from '../../../utils/fetchLlmUnified';


const  generateChatMessageAiSummaryById = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
    try {
        const chatMessageRecords = await ModelChatLlm.find({
            _id: targetRecordId,
        }) as IChatLlm[];

        if (!chatMessageRecords || chatMessageRecords.length !== 1) {
            return true;
        }

        const chatMessageFirst = chatMessageRecords[0];

        // Get LLM config using centralized function
        const llmConfig = await getDefaultLlmModel(chatMessageFirst.username);
        if (!llmConfig.featureAiActionsEnabled || !llmConfig.provider) {
            return true; // Skip if no LLM available
        }

        // Check if Chat Message AI feature is enabled for this user
        const user = await ModelUser.findOne({ username: chatMessageFirst.username });
        if (!user || !user.featureAiActionsChatMessage) {
            return true; // Skip if Chat Message AI is not enabled for this user
        }

        const updateObj = {
        } as {
            aiSummary?: string;
        };

        let argContent = chatMessageFirst.content.replace('Text to audio:', '');
        if(chatMessageFirst.fileContentText && chatMessageFirst.fileContentText.length >= 1) {
            argContent += `\nFile Content: ${chatMessageFirst.fileContentText}`;
        }

        let systemPrompt = `From the below content, generate a very detailed summary in simple language.
        Only output the summary, no other text. No markdown.
        Suggest out of the box ideas.
        Suggest few actions that can be taken.
        Suggestions for chat messages.
        Suggest few thoughtful questions that can be asked to the user to gather more information, uncover hidden needs, or improve the contents relevance and impact.`;

        const messages: Message[] = [
            {
                role: "system",
                content: systemPrompt,
            },
            {
                role: "user",
                content: argContent,
            }
        ];

        // Use fetchLlmUnified with the config
        const llmResult = await fetchLlmUnified({
            provider: llmConfig.provider as 'openrouter' | 'groq' | 'ollama' | 'openai-compatible',
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: llmConfig.modelName,
            messages,
            temperature: 0,
            maxTokens: 1024,
            topP: 1,
            responseFormat: 'text',
        });

        if (llmResult.success && llmResult.content && llmResult.content.length >= 1) {
            updateObj.aiSummary = llmResult.content;
        }

        if (Object.keys(updateObj).length >= 1) {
            await ModelChatLlm.updateOne(
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

export default generateChatMessageAiSummaryById;

