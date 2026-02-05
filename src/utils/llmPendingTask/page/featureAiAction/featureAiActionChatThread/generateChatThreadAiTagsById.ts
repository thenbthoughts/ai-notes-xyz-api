import { ModelChatLlmThread } from "../../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema";
import { ModelChatLlm } from "../../../../../schema/schemaChatLlm/SchemaChatLlm.schema";
import { IChatLlm } from "../../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types";
import { getDefaultLlmModel } from '../../../utils/getDefaultLlmModel';
import fetchLlmUnified, { Message } from '../../../utils/fetchLlmUnified';


const  generateChatThreadAiTagsById = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
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
        if (!llmConfig.featureAiActionsEnabled || !llmConfig.provider) {
            return true; // Skip if no LLM available
        }

        const updateObj = {
        } as {
            tagsAi?: string[];
        };

        // Step 1: Generate summary
        const summaryMessages: Message[] = [];
        let systemPrompt = '';
        systemPrompt += `You are an AI thread summarizer specialized in summarizing multi-message discussion threads. `;
        systemPrompt += `Given a series of messages labeled as either user or assistant contributions, generate a concise and clear summary that captures the main points, key ideas, and important information shared across the entire thread. `;
        systemPrompt += `The summary should be brief, easy to understand, and free of added opinions or new information. `;
        systemPrompt += `Respond only with the summary text.`;

        summaryMessages.push({
            role: "system",
            content: systemPrompt,
        });

        for (let index = 0; index < messages.length; index++) {
            const element = messages[index];

            if (element.content.includes("AI:")) {
                summaryMessages.push({
                    role: "assistant",
                    content: `AI -> Conversation ${index + 1}: ${element.content.replace("AI:", "").trim()}`,
                });
            } else {
                summaryMessages.push({
                    role: "user",
                    content: `User -> Conversation ${index + 1}: ${element.content.replace('Text to audio:', '')}`,
                });
            }
        }

        summaryMessages.push({
            role: "user",
            content: "Summarize",
        });

        const summaryResult = await fetchLlmUnified({
            provider: llmConfig.provider as 'openrouter' | 'groq' | 'ollama' | 'openai-compatible',
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: llmConfig.modelName,
            messages: summaryMessages,
            temperature: 0,
            maxTokens: 1024,
            topP: 1,
        });

        if (summaryResult.success && summaryResult.content && summaryResult.content.length >= 1) {
            // Step 2: Generate tags from summary
            const tagsSystemPrompt = "You are a JSON-based AI assistant specialized in extracting key topics and terms from user notes. Your task is to identify and generate a list of significant keywords based on the content provided by the user. These keywords should represent the main ideas, themes, or topics covered in the user's input. Output the result in JSON format as follows:\n\n{\n  \"keywords\": [\"keyword 1\", \"keyword 2\", \"keyword 3\", ...]\n}\n\nFocus on capturing nouns, significant verbs, and unique terms relevant to the content.\nAvoid generic words (e.g., 'the,' 'is,' 'and') and words with no specific relevance.\nEnsure that the keywords are concise and meaningful for quick reference.\n\nRespond only with the JSON structure.";

            const tagsResult = await fetchLlmUnified({
                provider: llmConfig.provider as 'openrouter' | 'groq' | 'ollama' | 'openai-compatible',
                apiKey: llmConfig.apiKey,
                apiEndpoint: llmConfig.apiEndpoint,
                model: llmConfig.modelName,
                messages: [
                    { role: "system", content: tagsSystemPrompt },
                    { role: "user", content: summaryResult.content },
                ],
                temperature: 0,
                maxTokens: 1024,
                topP: 1,
                responseFormat: 'json_object',
            });

            if (tagsResult.success && tagsResult.content) {
                try {
                    const keywordsResponse = JSON.parse(tagsResult.content);
                    const finalTagsOutput = [] as string[];

                    if (Array.isArray(keywordsResponse?.keywords)) {
                        const keywords = keywordsResponse?.keywords;
                        for (let index = 0; index < keywords.length; index++) {
                            const element = keywords[index];
                            if (typeof element === 'string') {
                                finalTagsOutput.push(element.trim());
                            }
                        }
                    }

                    if (finalTagsOutput.length >= 1) {
                        updateObj.tagsAi = finalTagsOutput.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
                    }
                } catch (error) {
                    console.error('Error parsing tags JSON:', error);
                }
            }
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

export default generateChatThreadAiTagsById;

