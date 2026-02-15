import mongoose from "mongoose";
import { ModelChatLlmAnswerMachine } from "../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaChatLlmAnswerMachine.schema";
import { ModelChatLlm } from "../../../../../schema/schemaChatLlm/SchemaChatLlm.schema";
import { ModelOpenaiCompatibleModel } from "../../../../../schema/schemaUser/SchemaOpenaiCompatibleModel.schema";
import { ModelUserApiKey } from "../../../../../schema/schemaUser/SchemaUserApiKey.schema";
import { ModelAnswerMachineSubQuestion } from "../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineSubQuestions.schema";
import { ModelChatLlmThread } from "../../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema";
import { IChatLlm } from "../../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types";
import fetchLlmUnified, { Message } from "../../../../../utils/llmPendingTask/utils/fetchLlmUnified";
import { getApiKeyByObject } from "../../../../../utils/llm/llmCommonFunc";
import { trackAnswerMachineTokens } from "../helperFunction/tokenTracking";

interface LlmConfig {
    provider: 'groq' | 'openrouter' | 'ollama' | 'openai-compatible';
    apiKey: string;
    apiEndpoint: string;
    model: string;
    customHeaders?: Record<string, string>;
}

const step4GenerateFinalAnswer = async ({
    answerMachineRecordId,
}: {
    answerMachineRecordId: mongoose.Types.ObjectId;
}): Promise<{
    success: boolean;
    errorReason: string;
    data: {
        finalAnswer: string;
        messageId: mongoose.Types.ObjectId | null;
    } | null;
}> => {
    try {
        console.log('step4GenerateFinalAnswer', answerMachineRecordId);

        // Get the answer machine record to get thread info
        const answerMachineRecord = await ModelChatLlmAnswerMachine.findById(answerMachineRecordId);
        if (!answerMachineRecord) {
            return {
                success: false,
                errorReason: 'Answer machine record not found',
                data: null,
            };
        }

        const threadId = answerMachineRecord.threadId;
        const username = answerMachineRecord.username;

        console.log('Generating final answer for thread:', threadId);

        // Inline implementation from GenerateFinalAnswer class
        const result = await generateFinalAnswerInline(threadId, username, answerMachineRecordId);

        if (!result.success) {
            console.error('Failed to generate final answer:', result.errorReason);
            return {
                success: false,
                errorReason: result.errorReason || 'Failed to generate final answer',
                data: null,
            };
        }

        // Update the answer machine record with the final answer
        await ModelChatLlmAnswerMachine.findByIdAndUpdate(answerMachineRecordId, {
            $set: {
                finalAnswer: result.finalAnswer,
            }
        });

        console.log('Successfully generated final answer');
        return {
            success: true,
            errorReason: '',
            data: {
                finalAnswer: result.finalAnswer,
                messageId: result.messageId,
            },
        };

    } catch (error) {
        console.error(`❌ Error in step4GenerateFinalAnswer (answerMachineRecord ${answerMachineRecordId}):`, error);
        const errorMessage = error instanceof Error ? error.message : 'Internal server error';
        return {
            success: false,
            errorReason: errorMessage,
            data: null,
        };
    }
};

/**
 * Inline implementation of GenerateFinalAnswer.execute()
 */
async function generateFinalAnswerInline(
    threadId: mongoose.Types.ObjectId,
    username: string,
    answerMachineRecordId: mongoose.Types.ObjectId
): Promise<{
    success: boolean;
    finalAnswer: string;
    messageId: mongoose.Types.ObjectId | null;
    errorReason?: string;
}> {
    // Initialize thread and LLM config
    const thread = await ModelChatLlmThread.findOne({
        _id: threadId,
        username: username,
    });

    if (!thread) {
        return {
            success: false,
            finalAnswer: '',
            messageId: null,
            errorReason: 'Thread not found',
        };
    }

    const llmConfig = await getLlmConfigInline(thread, username);
    if (!llmConfig) {
        return {
            success: false,
            finalAnswer: '',
            messageId: null,
            errorReason: 'Failed to initialize or missing LLM config',
        };
    }

    // Generate final answer
    const finalAnswerResult = await generateFinalAnswerContent(thread, llmConfig, threadId, username, answerMachineRecordId);
    if (!finalAnswerResult.answer) {
        return {
            success: false,
            finalAnswer: '',
            messageId: null,
            errorReason: 'Failed to generate final answer',
        };
    }

    // Track tokens from final answer generation
    if (finalAnswerResult.tokens) {
        await trackAnswerMachineTokens(threadId, finalAnswerResult.tokens, username, 'final_answer');
    }

    // Note: Message creation is now handled in step5 (evaluation) to ensure final answer is generated only once
    return {
        success: true,
        finalAnswer: finalAnswerResult.answer,
        messageId: null, // Message will be created in step5 when evaluation is satisfactory
    };
}

/**
 * Get LLM configuration for the user
 */
async function getLlmConfigInline(thread: any, username: string): Promise<LlmConfig | null> {
    try {
        const userApiKeyDoc = await ModelUserApiKey.findOne({
            username: username,
        });
        if (!userApiKeyDoc) {
            return null;
        }

        const userApiKey = getApiKeyByObject(userApiKeyDoc);

        let llmAuthToken = '';
        let llmEndpoint = '';
        let customHeaders: Record<string, string> | undefined = undefined;
        let selectedProvider: 'groq' | 'openrouter' | 'ollama' | 'openai-compatible' | null = null;
        let modelName = '';

        // Use thread's model settings if available, otherwise use default priority
        if (thread.aiModelProvider && thread.aiModelName) {
            selectedProvider = thread.aiModelProvider as 'groq' | 'openrouter' | 'ollama' | 'openai-compatible';
            modelName = thread.aiModelName;

            if (selectedProvider === 'groq' && userApiKey.apiKeyGroqValid && userApiKey.apiKeyGroq) {
                llmAuthToken = userApiKey.apiKeyGroq;
            } else if (selectedProvider === 'openrouter' && userApiKey.apiKeyOpenrouterValid && userApiKey.apiKeyOpenrouter) {
                llmAuthToken = userApiKey.apiKeyOpenrouter;
            } else if (selectedProvider === 'ollama' && userApiKey.apiKeyOllamaValid && userApiKey.apiKeyOllamaEndpoint) {
                llmEndpoint = userApiKey.apiKeyOllamaEndpoint;
            } else if (selectedProvider === 'openai-compatible' && thread.aiModelOpenAiCompatibleConfigId) {
                const config = await ModelOpenaiCompatibleModel.findById(thread.aiModelOpenAiCompatibleConfigId);
                if (config && config.apiKey && config.baseUrl) {
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
                }
            }
        }

        // Fallback to default priority if thread settings not available or invalid
        if (!selectedProvider || !llmAuthToken && selectedProvider !== 'ollama' || selectedProvider === 'ollama' && !llmEndpoint) {
            if (userApiKey.apiKeyGroqValid && userApiKey.apiKeyGroq) {
                selectedProvider = 'groq';
                llmAuthToken = userApiKey.apiKeyGroq;
                modelName = 'openai/gpt-oss-20b';
            } else if (userApiKey.apiKeyOpenrouterValid && userApiKey.apiKeyOpenrouter) {
                selectedProvider = 'openrouter';
                llmAuthToken = userApiKey.apiKeyOpenrouter;
                modelName = 'openai/gpt-oss-20b';
            } else if (userApiKey.apiKeyOllamaValid && userApiKey.apiKeyOllamaEndpoint) {
                selectedProvider = 'ollama';
                llmEndpoint = userApiKey.apiKeyOllamaEndpoint;
                modelName = 'llama3.2';
            } else {
                const config = await ModelOpenaiCompatibleModel.findOne({
                    username: username,
                }).sort({ createdAtUtc: -1 });

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
                        modelName = 'gpt-4o-mini';
                    }
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
        console.error('Error in getLlmConfig:', error);
        return null;
    }
}

/**
 * Get all conversation messages
 */
async function getConversationMessages(threadId: mongoose.Types.ObjectId, username: string): Promise<IChatLlm[]> {
    try {
        const messages = await ModelChatLlm.aggregate([
            {
                $match: {
                    threadId: threadId,
                    username: username,
                    type: 'text',
                }
            },
            {
                $sort: {
                    createdAtUtc: 1,
                }
            }
        ]) as IChatLlm[];

        return messages;
    } catch (error) {
        console.error('Error in getConversationMessages:', error);
        return [];
    }
}

/**
 * Get all answered sub-questions for a specific answer machine record
 */
async function getAnsweredSubQuestions(answerMachineRecordId: mongoose.Types.ObjectId): Promise<Array<{
    question: string;
    answer: string;
}>> {
    try {
        const answeredSubQuestions = await ModelAnswerMachineSubQuestion.find({
            answerMachineRecordId: answerMachineRecordId,
            status: 'answered',
        }).sort({ createdAtUtc: 1 });

        return answeredSubQuestions
            .filter(sq => sq.question && sq.answer)
            .map(sq => ({
                question: sq.question || '',
                answer: sq.answer || '',
            }));
    } catch (error) {
        console.error('Error in getAnsweredSubQuestions:', error);
        return [];
    }
}

/**
 * Format conversation messages for LLM
 */
function formatConversationMessages(messages: IChatLlm[]): string {
    if (messages.length === 0) {
        return '';
    }

    return messages
        .map((msg, index) => {
            const role = msg.isAi ? 'Assistant' : 'User';
            return `${role}: ${msg.content || ''}`;
        })
        .join('\n\n');
}

/**
 * Format sub-question answers for LLM
 */
function formatSubQuestionAnswers(subQuestions: Array<{ question: string; answer: string }>): string {
    if (subQuestions.length === 0) {
        return '';
    }

    return subQuestions
        .map((sq, index) => {
            return `Q${index + 1}: ${sq.question}\nA${index + 1}: ${sq.answer}`;
        })
        .join('\n\n');
}

/**
 * Generate final comprehensive answer
 */
async function generateFinalAnswerContent(
    thread: any,
    llmConfig: LlmConfig,
    threadId: mongoose.Types.ObjectId,
    username: string,
    answerMachineRecordId: mongoose.Types.ObjectId
): Promise<{
    answer: string;
    tokens?: {
        promptTokens: number;
        completionTokens: number;
        reasoningTokens: number;
        totalTokens: number;
        costInUsd: number;
    };
}> {
    try {
        // Get conversation messages
        const conversationMessages = await getConversationMessages(threadId, username);
        const conversationText = formatConversationMessages(conversationMessages);

        // Get answered sub-questions for this specific answer machine record
        const answeredSubQuestions = await getAnsweredSubQuestions(answerMachineRecordId);
        const subQuestionsText = formatSubQuestionAnswers(answeredSubQuestions);

        // Get system prompt from thread
        const systemPrompt = thread?.systemPrompt || 'You are a helpful AI assistant.';

        // Build user prompt
        let userPrompt = '';

        if (conversationText) {
            userPrompt += `CONVERSATION HISTORY:\n${conversationText}\n\n`;
        }

        if (subQuestionsText) {
            userPrompt += `RESEARCH FINDINGS (Answers to sub-questions):\n${subQuestionsText}\n\n`;
        }

        userPrompt += `Based on the conversation history and the research findings above, provide a comprehensive final answer that:\n`;
        userPrompt += `1. Directly addresses the user's main question or problem\n`;
        userPrompt += `2. Synthesizes information from the research findings\n`;
        userPrompt += `3. Provides a clear, well-structured response\n`;
        userPrompt += `4. If any information is still missing, acknowledge it clearly\n\n`;
        userPrompt += `FINAL ANSWER:`;

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

        // Use thread temperature and max tokens if available
        const temperature = thread?.chatLlmTemperature ?? 0.7;
        const maxTokens = thread?.chatLlmMaxTokens ?? 4096;

        const llmResult = await fetchLlmUnified({
            provider: llmConfig.provider,
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: llmConfig.model,
            messages: llmMessages,
            temperature,
            maxTokens,
            headersExtra: llmConfig.customHeaders,
        });

        if (!llmResult.success || !llmResult.content) {
            console.error('Failed to generate final answer:', llmResult.error);
            return { answer: '' };
        }

        // Track tokens for final answer generation using usageStats from fetchLlmUnified
        try {
            await trackAnswerMachineTokens(
                threadId,
                llmResult.usageStats,
                username,
                'final_answer'
            );
        } catch (tokenError) {
            console.warn(`[Final Answer] Failed to track tokens:`, tokenError);
        }

        return {
            answer: llmResult.content.trim(),
            tokens: llmResult.usageStats,
        };
    } catch (error) {
        console.error('Error in generateFinalAnswer:', error);
        return { answer: '' };
    }
}


export default step4GenerateFinalAnswer;