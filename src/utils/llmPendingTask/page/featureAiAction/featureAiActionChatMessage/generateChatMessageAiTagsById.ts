import { ModelChatLlm } from "../../../../../schema/schemaChatLlm/SchemaChatLlm.schema";
import { ModelUser } from "../../../../../schema/schemaUser/SchemaUser.schema";
import { IChatLlm } from "../../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types";
import { getDefaultLlmModel } from '../../../utils/getDefaultLlmModel';
import fetchLlmUnified from '../../../utils/fetchLlmUnified';


const  generateChatMessageAiTagsById = async ({
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
            tagsAutoAi?: string[];
        };

        let argContent = chatMessageFirst.content.replace('Text to audio:', '');
        if(chatMessageFirst.fileContentText && chatMessageFirst.fileContentText.length >= 1) {
            argContent += `\nFile Content: ${chatMessageFirst.fileContentText}`;
        }

        let systemPrompt = `You are a JSON-based AI assistant specialized in extracting key topics and terms from chat messages.
        Your task is to identify and generate a list of significant keywords based on the chat message content provided by the user.
        These keywords should represent the main ideas, themes, or topics covered in the message.

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
                    updateObj.tagsAutoAi = parsed.keywords
                        .filter((tag: any) => typeof tag === 'string' && tag.trim().length > 0)
                        .map((tag: string) => tag.trim())
                        .sort((a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase()));
                }
            } catch (parseError) {
                console.error('Failed to parse AI tags response:', parseError);
            }
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

export default generateChatMessageAiTagsById;

