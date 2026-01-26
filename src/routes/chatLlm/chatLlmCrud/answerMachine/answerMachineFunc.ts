import mongoose from "mongoose";
import { ModelOpenaiCompatibleModel } from "../../../../schema/schemaUser/SchemaOpenaiCompatibleModel.schema";

import { ModelUserApiKey } from "../../../../schema/schemaUser/SchemaUserApiKey.schema";

import { ModelChatLlm } from "../../../../schema/schemaChatLlm/SchemaChatLlm.schema";
import { IChatLlm } from "../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types";

import { ModelChatLlmThread } from "../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema";
import fetchLlmUnified, { Message } from "../../../../utils/llmPendingTask/utils/fetchLlmUnified";
import { ModelAnswerMachineSubQuestion } from "../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineSubQuestions.schema";
import { IAnswerMachineSubQuestion } from "../../../../types/typesSchema/typesChatLlm/typesAnswerMachine/SchemaAnswerMachineSubQuestions.types";
import AnswerSubQuestion from "./utils/AnswerSubQuestion";
import GenerateFinalAnswer from "./utils/GenerateFinalAnswer";

interface LlmConfig {
    provider: 'groq' | 'openrouter' | 'ollama' | 'openai-compatible';
    apiKey: string;
    apiEndpoint: string;
    model: string;
    customHeaders?: Record<string, string>;
}

const getLlmConfigForThread = async ({
    username,
}: {
    username: string;
}): Promise<LlmConfig | null> => {
    try {
        // Get user API keys
        const userApiKey = await ModelUserApiKey.findOne({
            username: username,
        });
        if (!userApiKey) {
            return null;
        }

        let llmAuthToken = '';
        let llmEndpoint = '';
        let customHeaders: Record<string, string> | undefined = undefined;
        let selectedProvider: 'groq' | 'openrouter' | 'ollama' | 'openai-compatible' | null = null;
        let modelName = '';

        // Select provider in priority order: groq > openrouter > ollama > openai-compatible
        if (userApiKey.apiKeyGroqValid && userApiKey.apiKeyGroq) {
            selectedProvider = 'groq';
            llmAuthToken = userApiKey.apiKeyGroq;
            modelName = 'openai/gpt-oss-20b'; // Default Groq model
        } else if (userApiKey.apiKeyOpenrouterValid && userApiKey.apiKeyOpenrouter) {
            selectedProvider = 'openrouter';
            llmAuthToken = userApiKey.apiKeyOpenrouter;
            modelName = 'openai/gpt-oss-20b'; // Default OpenRouter model
        } else if (userApiKey.apiKeyOllamaValid && userApiKey.apiKeyOllamaEndpoint) {
            selectedProvider = 'ollama';
            llmAuthToken = '';
            llmEndpoint = userApiKey.apiKeyOllamaEndpoint;
            modelName = 'llama3.2'; // Default Ollama model
        } else {
            // Try openai-compatible as fallback - find first available config for user
            const config = await ModelOpenaiCompatibleModel.findOne({
                username: username,
            }).sort({ createdAtUtc: -1 }); // Get most recent config

            if (config && config.apiKey && config.baseUrl) {
                selectedProvider = 'openai-compatible';
                llmAuthToken = config.apiKey;
                let baseUrl = config.baseUrl.trim();
                if (!baseUrl.endsWith('/chat/completions')) {
                    baseUrl = baseUrl.replace(/\/$/, '') + '/chat/completions';
                }
                llmEndpoint = baseUrl;

                if (config.customHeaders && config.customHeaders.trim()) {
                    try {
                        customHeaders = JSON.parse(config.customHeaders);
                    } catch (e) {
                        console.error('Error parsing custom headers:', e);
                    }
                }

                if (config.modelName && config.modelName.trim()) {
                    modelName = config.modelName;
                } else {
                    modelName = 'gpt-4o-mini'; // Default OpenAI-compatible model
                }
            }
        }

        if (!selectedProvider) {
            return null;
        }

        if (!llmAuthToken && selectedProvider !== 'ollama') {
            return null;
        }
        if (selectedProvider === 'ollama' && !llmEndpoint) {
            return null;
        }

        return {
            provider: selectedProvider,
            apiKey: llmAuthToken,
            apiEndpoint: llmEndpoint,
            model: modelName,
            customHeaders,
        };
    } catch (error) {
        console.error('Error in getLlmConfigForThread:', error);
        return null;
    }
};

const step1GetConversation = async ({
    threadId,
    username,
}: {
    threadId: mongoose.Types.ObjectId;
    username: string;
}): Promise<IChatLlm[]> => {
    try {
        const conversation = await ModelChatLlm.find({
            threadId,
            username,
        });
        return conversation;
    } catch (error) {
        console.error('❌ Error in step1GetConversation:', error);
        return [];
    }
}

const step2CreateQuestionDecompositionAndInsert = async ({
    threadId,
}: {
    threadId: mongoose.Types.ObjectId;
}): Promise<string[]> => {
    try {
        const thread = await ModelChatLlmThread.findById(threadId);
        if (!thread) {
            return [];
        }

        // Get last 10 messages
        const last10Messages = await ModelChatLlm.aggregate([
            {
                $match: {
                    threadId,
                }
            },
            {
                $sort: {
                    createdAtUtc: -1,
                }
            },
            {
                $limit: 10,
            },
            {
                $sort: {
                    createdAtUtc: 1,
                }
            }
        ]) as IChatLlm[];

        if (last10Messages.length === 0) {
            return [];
        }

        const lastMessage = last10Messages[last10Messages.length - 1];
        if (!lastMessage) {
            console.log('No last message found');
            return [];
        }
        const lastMessageId = lastMessage._id;

        // Prepare messages for LLM
        const messagesContent = last10Messages
            .filter(msg => msg.type === 'text' && msg.content)
            .map(msg => msg.content)
            .join('\n\n');

        if (!messagesContent || messagesContent.trim().length === 0) {
            return [];
        }

        let systemPrompt = '';
        systemPrompt += `Given a user conversation, identify missing information required to solve the user's core problem. Reply with a JSON object:\n`;
        systemPrompt += `{"missingRequirements": [essential missing info questions], "contextualQuestions": [2-3 context questions], "implementationDetails": [2-3 implementation questions]}.\n`;
        systemPrompt += `Exclude anything about formatting, presentation, or display preferences. Use empty arrays if nothing is missing.`;

        let userPrompt = '';
        userPrompt += `Analyze the following conversation and identify any missing requirements needed to solve the user's question.`;
        userPrompt += `Focus on information that is actually required but not provided:\n\n${messagesContent}`;

        // Prepare LLM messages
        const llmMessages: Message[] = [
            {
                role: 'system',
                content: systemPrompt,
            },
            {
                role: 'user',
                content: userPrompt,
            },
        ];

        // Get LLM configuration
        const llmConfig = await getLlmConfigForThread({
            username: thread.username,
        });

        if (!llmConfig) {
            return [];
        }

        // Call fetchLlmUnified
        const llmResult = await fetchLlmUnified({
            provider: llmConfig.provider,
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: llmConfig.model,
            messages: llmMessages,
            temperature: 0.7,
            maxTokens: 4096,
            responseFormat: 'json_object',
            headersExtra: llmConfig.customHeaders,
        });

        if (!llmResult.success || !llmResult.content) {
            console.error('Failed to generate question decomposition:', llmResult.error);
            return [];
        }

        console.log('llmResult.content', llmResult.content);

        let parsed: any;
        try {
            parsed = JSON.parse(llmResult.content);
        } catch (err) {
            console.error('Failed to parse LLM result content:', llmResult.content);
            return [];
        }

        // Updated keys according to current prompt and format
        let allQuestions: string[] = [];

        // Extract missing requirements
        if (parsed?.missingRequirements && Array.isArray(parsed.missingRequirements)) {
            allQuestions.push(...parsed.missingRequirements);
        }
        // Extract contextual questions
        if (parsed?.contextualQuestions && Array.isArray(parsed.contextualQuestions)) {
            allQuestions.push(...parsed.contextualQuestions);
        }
        // Extract implementation details questions
        if (parsed?.implementationDetails && Array.isArray(parsed.implementationDetails)) {
            allQuestions.push(...parsed.implementationDetails);
        }

        // Fallback: nothing found, return empty
        if (allQuestions.length === 0) {
            return [];
        }

        let insertManyArr = [] as Partial<IAnswerMachineSubQuestion>[];

        for (const question of allQuestions) {
            insertManyArr.push({
                threadId,
                parentMessageId: lastMessageId,
                question,

                // auth
                username: thread.username,
            });
        }

        console.log('insertManyArr', insertManyArr);

        // Insert sub-questions into database
        const subQuestions = await ModelAnswerMachineSubQuestion.insertMany(insertManyArr);

        return subQuestions.map(subQuestion => subQuestion.question || '');
    } catch (error) {
        console.error('❌ Error in step2CreateQuestionDecompositionAndInsert:', error);
        return [];
    }
}

const step3AnswerSubQuestions = async ({
    threadId,
}: {
    threadId: mongoose.Types.ObjectId;
}): Promise<void> => {
    try {
        // Get all pending sub-questions for this thread
        const pendingSubQuestions = await ModelAnswerMachineSubQuestion.find({
            threadId,
            status: 'pending',
        });

        if (pendingSubQuestions.length === 0) {
            return;
        }

        // Process each sub-question
        for (const subQuestion of pendingSubQuestions) {
            try {
                // Create AnswerSubQuestion instance and execute
                const answerSubQuestion = new AnswerSubQuestion(subQuestion._id as mongoose.Types.ObjectId);
                const result = await answerSubQuestion.execute();

                if (result.success) {
                    // Update sub-question with answer and context IDs
                    await ModelAnswerMachineSubQuestion.findByIdAndUpdate(subQuestion._id, {
                        $set: {
                            answer: result.answer,
                            contextIds: result.contextIds,
                            status: 'answered',
                            updatedAtUtc: new Date(),
                        }
                    });
                } else {
                    // Update with error status
                    await ModelAnswerMachineSubQuestion.findByIdAndUpdate(subQuestion._id, {
                        $set: {
                            status: 'error',
                            errorReason: result.errorReason || 'Unknown error',
                            updatedAtUtc: new Date(),
                        }
                    });
                }
            } catch (error) {
                console.error(`Error processing sub-question ${subQuestion._id}:`, error);
                // Update with error status
                await ModelAnswerMachineSubQuestion.findByIdAndUpdate(subQuestion._id, {
                    $set: {
                        status: 'error',
                        errorReason: error instanceof Error ? error.message : 'Unknown error',
                        updatedAtUtc: new Date(),
                    }
                });
            }
        }
    } catch (error) {
        console.error('❌ Error in step3AnswerSubQuestions:', error);
    }
}

const step4GenerateFinalAnswer = async ({
    threadId,
    username,
}: {
    threadId: mongoose.Types.ObjectId;
    username: string;
}): Promise<void> => {
    try {
        // Check if there are any answered sub-questions
        const answeredSubQuestions = await ModelAnswerMachineSubQuestion.find({
            threadId,
            username,
            status: 'answered',
        });

        // Only generate final answer if there are answered sub-questions
        if (answeredSubQuestions.length === 0) {
            console.log('No answered sub-questions found, skipping final answer generation');
            return;
        }

        // Create GenerateFinalAnswer instance and execute
        const generateFinalAnswer = new GenerateFinalAnswer(threadId, username);
        const result = await generateFinalAnswer.execute();

        if (result.success) {
            console.log('Final answer generated successfully, messageId:', result.messageId);
        } else {
            console.error('Failed to generate final answer:', result.errorReason);
        }
    } catch (error) {
        console.error('❌ Error in step4GenerateFinalAnswer:', error);
    }
}

const answerMachineFunc = async ({
    threadId,
    username,
}: {
    threadId: mongoose.Types.ObjectId;
    username: string;
}): Promise<{
    success: boolean;
    errorReason: string;
    data: null;
}> => {
    try {
        // get conversation
        const conversationList = await step1GetConversation({
            threadId,
            username,
        });

        if (conversationList.length === 0) {
            return {
                success: false,
                errorReason: 'No conversation found',
                data: null,
            };
        }

        // is last conversation is ai, then return
        if (conversationList[conversationList.length - 1].isAi === true) {
            return {
                success: false,
                errorReason: 'Last conversation is ai',
                data: null,
            };
        }

        // create question decomposition
        const questionDecomposition = await step2CreateQuestionDecompositionAndInsert({
            threadId,
        });
        console.log('questionDecomposition', questionDecomposition);

        // answer sub-questions
        await step3AnswerSubQuestions({
            threadId,
        });

        // generate final answer based on all messages and sub-question answers
        await step4GenerateFinalAnswer({
            threadId,
            username,
        });

        return {
            success: true,
            errorReason: '',
            data: null,
        };
    } catch (error) {
        console.error('❌ Error in answerMachineFunc:', error);
        return {
            success: false,
            errorReason: 'Internal server error',
            data: null,
        };
    }

};

export default answerMachineFunc;