import { ModelChatLlmThread } from "../../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema";
import { ModelChatLlm } from "../../../../../schema/schemaChatLlm/SchemaChatLlm.schema";
import { IChatLlm } from "../../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types";
import { getDefaultLlmModel } from '../../../utils/getDefaultLlmModel';
import fetchLlmUnified, { Message } from '../../../utils/fetchLlmUnified';


const  generateChatThreadAiSummaryById = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
    console.log('generateChatThreadAiSummaryById', targetRecordId);
    try {
        const messages = await ModelChatLlm.find({
            threadId: targetRecordId,
        }) as IChatLlm[];

        if (!messages || messages.length === 0) {
            return true;
        }

        const messageFirst = messages[0];

        // Get LLM config using centralized function
        const llmConfig = await getDefaultLlmModel(messageFirst.username);
        console.log('llmConfig', llmConfig);
        if (!llmConfig.featureAiActionsEnabled || !llmConfig.provider) {
            return true; // Skip if no LLM available
        }

        const updateObj = {
        } as {
            aiSummary?: string;
        };

        // Build messages array
        const messagesArray: Message[] = [];
        let systemPrompt = '';
        systemPrompt += `You are an AI thread summarizer specialized in summarizing multi-message discussion threads. `;
        systemPrompt += `Given a series of messages labeled as either user or assistant contributions, generate a concise and clear summary that captures the main points, key ideas, and important information shared across the entire thread. `;
        systemPrompt += `The summary should be brief, easy to understand, and free of added opinions or new information. `;
        systemPrompt += `Respond only with the summary text.`;

        messagesArray.push({
            role: "system",
            content: systemPrompt,
        });

        for (let index = 0; index < messages.length; index++) {
            const element = messages[index];

            if (element.content.includes("AI:")) {
                messagesArray.push({
                    role: "assistant",
                    content: `AI -> Conversation ${index + 1}: ${element.content.replace("AI:", "").trim()}`,
                });
            } else {
                messagesArray.push({
                    role: "user",
                    content: `User -> Conversation ${index + 1}: ${element.content.replace('Text to audio:', '')}`,
                });
            }
        }

        messagesArray.push({
            role: "user",
            content: "Summarize",
        });

        // Use fetchLlmUnified with the config
        const llmResult = await fetchLlmUnified({
            provider: llmConfig.provider as 'openrouter' | 'groq' | 'ollama' | 'openai-compatible',
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: llmConfig.modelName,
            messages: messagesArray,
            temperature: 0,
            maxTokens: 1024,
            topP: 1,
        });

        if (llmResult.success && llmResult.content && llmResult.content.length >= 1) {
            updateObj.aiSummary = llmResult.content;
        }

        if (Object.keys(updateObj).length >= 1) {
            await ModelChatLlmThread.updateOne(
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

export default generateChatThreadAiSummaryById;

