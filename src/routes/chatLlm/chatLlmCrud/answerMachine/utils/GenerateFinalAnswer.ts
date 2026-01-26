import mongoose from "mongoose";
import { ModelOpenaiCompatibleModel } from "../../../../../schema/schemaUser/SchemaOpenaiCompatibleModel.schema";
import { ModelUserApiKey } from "../../../../../schema/schemaUser/SchemaUserApiKey.schema";
import { ModelAnswerMachineSubQuestion } from "../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineSubQuestions.schema";
import { ModelChatLlm } from "../../../../../schema/schemaChatLlm/SchemaChatLlm.schema";
import { ModelChatLlmThread } from "../../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema";
import { IChatLlm } from "../../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types";
import fetchLlmUnified, { Message } from "../../../../../utils/llmPendingTask/utils/fetchLlmUnified";
import { getApiKeyByObject } from "../../../../../utils/llm/llmCommonFunc";

interface LlmConfig {
    provider: 'groq' | 'openrouter' | 'ollama' | 'openai-compatible';
    apiKey: string;
    apiEndpoint: string;
    model: string;
    customHeaders?: Record<string, string>;
}

class GenerateFinalAnswer {
    private threadId: mongoose.Types.ObjectId;
    private username: string;
    private llmConfig: LlmConfig | null = null;
    private thread: any = null;

    constructor(threadId: mongoose.Types.ObjectId, username: string) {
        this.threadId = threadId;
        this.username = username;
    }

    /**
     * Initialize the class by loading thread data and LLM config
     */
    private async initialize(): Promise<boolean> {
        try {
            // Get thread
            this.thread = await ModelChatLlmThread.findOne({
                _id: this.threadId,
                username: this.username,
            });

            if (!this.thread) {
                return false;
            }

            // Get LLM configuration
            this.llmConfig = await this.getLlmConfig();
            if (!this.llmConfig) {
                return false;
            }

            return true;
        } catch (error) {
            console.error('Error initializing GenerateFinalAnswer:', error);
            return false;
        }
    }

    /**
     * Get LLM configuration for the user
     */
    private async getLlmConfig(): Promise<LlmConfig | null> {
        try {
            const userApiKeyDoc = await ModelUserApiKey.findOne({
                username: this.username,
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
            if (this.thread.aiModelProvider && this.thread.aiModelName) {
                selectedProvider = this.thread.aiModelProvider as 'groq' | 'openrouter' | 'ollama' | 'openai-compatible';
                modelName = this.thread.aiModelName;

                if (selectedProvider === 'groq' && userApiKey.apiKeyGroqValid && userApiKey.apiKeyGroq) {
                    llmAuthToken = userApiKey.apiKeyGroq;
                } else if (selectedProvider === 'openrouter' && userApiKey.apiKeyOpenrouterValid && userApiKey.apiKeyOpenrouter) {
                    llmAuthToken = userApiKey.apiKeyOpenrouter;
                } else if (selectedProvider === 'ollama' && userApiKey.apiKeyOllamaValid && userApiKey.apiKeyOllamaEndpoint) {
                    llmEndpoint = userApiKey.apiKeyOllamaEndpoint;
                } else if (selectedProvider === 'openai-compatible' && this.thread.aiModelOpenAiCompatibleConfigId) {
                    const config = await ModelOpenaiCompatibleModel.findById(this.thread.aiModelOpenAiCompatibleConfigId);
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
                        username: this.username,
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
    private async getConversationMessages(): Promise<IChatLlm[]> {
        try {
            const messages = await ModelChatLlm.aggregate([
                {
                    $match: {
                        threadId: this.threadId,
                        username: this.username,
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
     * Get all answered sub-questions
     */
    private async getAnsweredSubQuestions(): Promise<Array<{
        question: string;
        answer: string;
    }>> {
        try {
            const answeredSubQuestions = await ModelAnswerMachineSubQuestion.find({
                threadId: this.threadId,
                username: this.username,
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
    private formatConversationMessages(messages: IChatLlm[]): string {
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
    private formatSubQuestionAnswers(subQuestions: Array<{ question: string; answer: string }>): string {
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
    async generateFinalAnswer(): Promise<string> {
        try {
            if (!this.llmConfig) {
                return '';
            }

            // Get conversation messages
            const conversationMessages = await this.getConversationMessages();
            const conversationText = this.formatConversationMessages(conversationMessages);

            // Get answered sub-questions
            const answeredSubQuestions = await this.getAnsweredSubQuestions();
            const subQuestionsText = this.formatSubQuestionAnswers(answeredSubQuestions);

            // Get system prompt from thread
            const systemPrompt = this.thread?.systemPrompt || 'You are a helpful AI assistant.';

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
            const temperature = this.thread?.chatLlmTemperature ?? 0.7;
            const maxTokens = this.thread?.chatLlmMaxTokens ?? 4096;

            const llmResult = await fetchLlmUnified({
                provider: this.llmConfig.provider,
                apiKey: this.llmConfig.apiKey,
                apiEndpoint: this.llmConfig.apiEndpoint,
                model: this.llmConfig.model,
                messages: llmMessages,
                temperature,
                maxTokens,
                headersExtra: this.llmConfig.customHeaders,
            });

            if (!llmResult.success || !llmResult.content) {
                console.error('Failed to generate final answer:', llmResult.error);
                return '';
            }

            return llmResult.content.trim();
        } catch (error) {
            console.error('Error in generateFinalAnswer:', error);
            return '';
        }
    }

    /**
     * Create final answer message in chat
     */
    async createFinalAnswerMessage(finalAnswer: string): Promise<mongoose.Types.ObjectId | null> {
        try {
            if (!finalAnswer || finalAnswer.trim().length === 0) {
                return null;
            }

            const newMessage = await ModelChatLlm.create({
                type: 'text',
                content: finalAnswer,
                username: this.username,
                threadId: this.threadId,
                isAi: true,
                aiModelProvider: this.llmConfig?.provider || '',
                aiModelName: this.llmConfig?.model || '',
                createdAtUtc: new Date(),
                updatedAtUtc: new Date(),
            });

            return newMessage._id as mongoose.Types.ObjectId;
        } catch (error) {
            console.error('Error in createFinalAnswerMessage:', error);
            return null;
        }
    }

    /**
     * Main method: Execute full workflow
     */
    async execute(): Promise<{
        success: boolean;
        finalAnswer: string;
        messageId: mongoose.Types.ObjectId | null;
        errorReason?: string;
    }> {
        try {
            // Initialize
            const initialized = await this.initialize();
            if (!initialized) {
                return {
                    success: false,
                    finalAnswer: '',
                    messageId: null,
                    errorReason: 'Failed to initialize or missing LLM config',
                };
            }

            // Generate final answer
            const finalAnswer = await this.generateFinalAnswer();
            if (!finalAnswer) {
                return {
                    success: false,
                    finalAnswer: '',
                    messageId: null,
                    errorReason: 'Failed to generate final answer',
                };
            }

            // Create message
            const messageId = await this.createFinalAnswerMessage(finalAnswer);
            if (!messageId) {
                return {
                    success: false,
                    finalAnswer,
                    messageId: null,
                    errorReason: 'Failed to create final answer message',
                };
            }

            return {
                success: true,
                finalAnswer,
                messageId,
            };
        } catch (error) {
            console.error('Error in GenerateFinalAnswer.execute:', error);
            return {
                success: false,
                finalAnswer: '',
                messageId: null,
                errorReason: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
}

export default GenerateFinalAnswer;
