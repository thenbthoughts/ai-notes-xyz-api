import mongoose from "mongoose";
import { ModelOpenaiCompatibleModel } from "../../../../../schema/schemaUser/SchemaOpenaiCompatibleModel.schema";
import { ModelUserApiKey } from "../../../../../schema/schemaUser/SchemaUserApiKey.schema";
import { ModelGlobalSearch } from "../../../../../schema/schemaGlobalSearch/SchemaGlobalSearch.schema";
import { ModelAnswerMachineSubQuestion } from "../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineSubQuestions.schema";
import { ModelChatLlm } from "../../../../../schema/schemaChatLlm/SchemaChatLlm.schema";
import { ModelTask } from "../../../../../schema/schemaTask/SchemaTask.schema";
import { ModelNotes } from "../../../../../schema/schemaNotes/SchemaNotes.schema";
import { ModelLifeEvents } from "../../../../../schema/schemaLifeEvents/SchemaLifeEvents.schema";
import { ModelInfoVault } from "../../../../../schema/schemaInfoVault/SchemaInfoVault.schema";
import { IChatLlm } from "../../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types";
import fetchLlmUnified, { Message } from "../../../../../utils/llmPendingTask/utils/fetchLlmUnified";
import { getApiKeyByObject } from "../../../../../utils/llm/llmCommonFunc";
import { NodeHtmlMarkdown } from "node-html-markdown";

interface LlmConfig {
    provider: 'groq' | 'openrouter' | 'ollama' | 'openai-compatible';
    apiKey: string;
    apiEndpoint: string;
    model: string;
    customHeaders?: Record<string, string>;
}

interface RelevantContextResponse {
    relevantItems: {
        entityId: string;
        relevanceScore: number;
        relevanceReason: string;
    }[];
}

class AnswerSubQuestion {
    private subQuestionId: mongoose.Types.ObjectId;
    private threadId: mongoose.Types.ObjectId | null = null;
    private username: string = '';
    private question: string = '';
    private llmConfig: LlmConfig | null = null;

    constructor(subQuestionId: mongoose.Types.ObjectId) {
        this.subQuestionId = subQuestionId;
    }

    /**
     * Initialize the class by loading sub-question data
     */
    private async initialize(): Promise<boolean> {
        try {
            const subQuestion = await ModelAnswerMachineSubQuestion.findById(this.subQuestionId);
            if (!subQuestion) {
                return false;
            }

            this.threadId = subQuestion.threadId;
            this.username = subQuestion.username;
            this.question = subQuestion.question || '';

            if (!this.threadId || !this.username || !this.question) {
                return false;
            }

            // Get LLM configuration
            this.llmConfig = await this.getLlmConfig();
            if (!this.llmConfig) {
                return false;
            }

            return true;
        } catch (error) {
            console.error('Error initializing AnswerSubQuestion:', error);
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

            // Select provider in priority order: groq > openrouter > ollama > openai-compatible
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
                llmAuthToken = '';
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
     * Get conversation context from thread
     */
    private async getConversationContext(): Promise<string> {
        try {
            if (!this.threadId) {
                return '';
            }

            const lastMessages = await ModelChatLlm.aggregate([
                {
                    $match: {
                        threadId: this.threadId,
                        username: this.username,
                        type: 'text',
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

            const conversationContext = lastMessages
                .map(msg => msg.content)
                .filter(content => typeof content === 'string' && content.trim().length > 0)
                .join('\n')
                .trim();

            return conversationContext;
        } catch (error) {
            console.error('Error in getConversationContext:', error);
            return '';
        }
    }

    /**
     * Step 1: Generate keywords from the sub-question
     */
    async generateKeywords(): Promise<string[]> {
        try {
            if (!this.llmConfig || !this.question) {
                return [];
            }

            const llmMessages: Message[] = [
                {
                    role: 'system',
                    content: 'You are a helpful assistant that extracts keywords from questions. Generate a JSON object with a "keywords" property containing an array of relevant SHORT keywords (around 10 keywords, each 1-3 words maximum) that summarize the main topics in the question. Keep keywords concise and specific. Example: {"keywords": ["API design", "database", "authentication"]}',
                },
                {
                    role: 'user',
                    content: `Extract around 10 SHORT keywords (1-3 words each) from the following question:\n\n${this.question}`,
                },
            ];

            const llmResult = await fetchLlmUnified({
                provider: this.llmConfig.provider,
                apiKey: this.llmConfig.apiKey,
                apiEndpoint: this.llmConfig.apiEndpoint,
                model: this.llmConfig.model,
                messages: llmMessages,
                temperature: 0.7,
                maxTokens: 2048,
                responseFormat: 'json_object',
                headersExtra: this.llmConfig.customHeaders,
            });

            if (!llmResult.success || !llmResult.content) {
                console.error('Failed to generate keywords:', llmResult.error);
                return [];
            }

            try {
                const parsed = JSON.parse(llmResult.content);
                let keywords: string[] = [];

                if (Array.isArray(parsed)) {
                    keywords = parsed;
                } else if (parsed?.keywords && Array.isArray(parsed.keywords)) {
                    keywords = parsed.keywords;
                } else if (parsed && typeof parsed === 'object') {
                    const values = Object.values(parsed);
                    const arrayValue = values.find(value => Array.isArray(value)) as string[] | undefined;
                    if (arrayValue) {
                        keywords = arrayValue;
                    }
                }

                return keywords
                    .filter(item => typeof item === 'string' && item.trim().length > 0)
                    .map(item => item.trim())
                    .slice(0, 10);
            } catch (parseError) {
                console.error('Failed to parse keywords JSON:', parseError);
                return [];
            }
        } catch (error) {
            console.error('Error in generateKeywords:', error);
            return [];
        }
    }

    /**
     * Step 2: Search for context IDs using keywords
     */
    async searchContextIds(keywords: string[]): Promise<mongoose.Types.ObjectId[]> {
        try {
            if (keywords.length === 0 || !this.threadId) {
                return [];
            }

            // Build search query conditions
            const searchQueryLower = keywords
                .map(k => k.toLowerCase().trim())
                .filter(k => k.length >= 1);

            if (searchQueryLower.length === 0) {
                return [];
            }

            const searchQueryOrConditions = searchQueryLower.map(item => {
                return { text: { $regex: item, $options: 'i' } };
            });

            const matchConditionsSearch = {
                $or: searchQueryOrConditions,
            };

            // Search global search by keywords
            const searchResults = await ModelGlobalSearch.aggregate([
                {
                    $match: {
                        username: this.username,
                        collectionName: { $in: ['tasks', 'notes', 'lifeEvents', 'infoVault'] }
                    }
                },
                { $sort: { updatedAtUtc: -1 } },
                { $match: matchConditionsSearch },
                { $sort: { updatedAtUtc: -1 } },
                { $limit: 20 },
            ]) as Array<{
                entityId: mongoose.Types.ObjectId;
                collectionName: string;
                text?: string;
            }>;

            if (searchResults.length === 0) {
                return [];
            }

            // Score context references with LLM
            const scoredItems = await this.scoreContextReferences(searchResults);

            if (scoredItems.length === 0) {
                return [];
            }

            // Return only relevant context IDs
            return scoredItems
                .filter(item => item.relevanceScore >= 6)
                .map(item => {
                    try {
                        return mongoose.Types.ObjectId.createFromHexString(item.entityId);
                    } catch {
                        return null;
                    }
                })
                .filter((id): id is mongoose.Types.ObjectId => id !== null);
        } catch (error) {
            console.error('Error in searchContextIds:', error);
            return [];
        }
    }

    /**
     * Score context references with LLM
     */
    private async scoreContextReferences(
        searchResults: Array<{
            entityId: mongoose.Types.ObjectId;
            collectionName: string;
            text?: string;
        }>
    ): Promise<RelevantContextResponse['relevantItems']> {
        try {
            if (!this.llmConfig || !this.threadId) {
                return [];
            }

            const conversationContext = await this.getConversationContext();
            const questionContext = `Question: ${this.question}`;

            const candidatesStr = searchResults
                .map(result => {
                    const rawText = typeof result.text === 'string' ? result.text : '';
                    const compactText = rawText.replace(/\s+/g, ' ').trim().slice(0, 600);
                    return [
                        `ID: ${result.entityId.toString()}`,
                        `Collection: ${result.collectionName}`,
                        `Text: ${compactText}`,
                    ].join('\n');
                })
                .join('\n\n');

            const llmMessages: Message[] = [
                {
                    role: 'system',
                    content: 'You are an AI assistant that evaluates relevance between a question and candidate context items. For each candidate, assign a relevanceScore (1-10) and a brief relevanceReason. Return ONLY items with relevanceScore >= 6. Respond in JSON format: {"relevantItems":[{"entityId":"...", "relevanceScore":7, "relevanceReason":"..."}]}',
                },
                {
                    role: 'user',
                    content: `QUESTION:\n${questionContext}\n\nCONVERSATION CONTEXT:\n${conversationContext}\n\nCANDIDATES:\n${candidatesStr}`,
                },
            ];

            const llmResult = await fetchLlmUnified({
                provider: this.llmConfig.provider,
                apiKey: this.llmConfig.apiKey,
                apiEndpoint: this.llmConfig.apiEndpoint,
                model: this.llmConfig.model,
                messages: llmMessages,
                temperature: 0.2,
                maxTokens: 4096,
                responseFormat: 'json_object',
                headersExtra: this.llmConfig.customHeaders,
            });

            if (!llmResult.success || !llmResult.content) {
                console.error('Failed to score context references:', llmResult.error);
                return [];
            }

            try {
                const parsed = JSON.parse(llmResult.content) as RelevantContextResponse;

                if (!parsed || typeof parsed !== 'object') {
                    console.error('Invalid context response: not an object');
                    return [];
                }

                if (!parsed.relevantItems || !Array.isArray(parsed.relevantItems)) {
                    console.error('Invalid context response: relevantItems not found or not an array');
                    return [];
                }

                const validItems = parsed.relevantItems.filter(item => {
                    return typeof item === 'object'
                        && item !== null
                        && typeof item.entityId === 'string'
                        && typeof item.relevanceScore === 'number'
                        && item.relevanceScore >= 6
                        && typeof item.relevanceReason === 'string';
                });

                return validItems;
            } catch (parseError) {
                console.error('Failed to parse context relevance JSON:', parseError);
                return [];
            }
        } catch (error) {
            console.error('Error in scoreContextReferences:', error);
            return [];
        }
    }

    /**
     * Step 3: Get context content from IDs
     */
    async getContextContent(contextIds: mongoose.Types.ObjectId[]): Promise<string> {
        try {
            if (contextIds.length === 0) {
                return '';
            }

            // Get context items from GlobalSearch to know their collection types
            const contextItems = await ModelGlobalSearch.find({
                username: this.username,
                entityId: { $in: contextIds },
            });

            const contextByCollection: Record<string, mongoose.Types.ObjectId[]> = {};
            for (const item of contextItems) {
                const collectionName = item.collectionName || 'unknown';
                if (!contextByCollection[collectionName]) {
                    contextByCollection[collectionName] = [];
                }
                contextByCollection[collectionName].push(item.entityId);
            }

            let contextContent = '';

            // Get tasks
            if (contextByCollection['tasks'] && contextByCollection['tasks'].length > 0) {
                contextContent += await this.getTasksContent(contextByCollection['tasks']);
            }

            // Get notes
            if (contextByCollection['notes'] && contextByCollection['notes'].length > 0) {
                contextContent += await this.getNotesContent(contextByCollection['notes']);
            }

            // Get life events
            if (contextByCollection['lifeEvents'] && contextByCollection['lifeEvents'].length > 0) {
                contextContent += await this.getLifeEventsContent(contextByCollection['lifeEvents']);
            }

            // Get info vault
            if (contextByCollection['infoVault'] && contextByCollection['infoVault'].length > 0) {
                contextContent += await this.getInfoVaultContent(contextByCollection['infoVault']);
            }

            return contextContent;
        } catch (error) {
            console.error('Error in getContextContent:', error);
            return '';
        }
    }

    /**
     * Get tasks content
     */
    private async getTasksContent(contextIds: mongoose.Types.ObjectId[]): Promise<string> {
        try {
            const resultTasks = await ModelTask.aggregate([
                {
                    $match: {
                        username: this.username,
                        _id: { $in: contextIds },
                    }
                },
                {
                    $lookup: {
                        from: 'taskWorkspace',
                        localField: 'taskWorkspaceId',
                        foreignField: '_id',
                        as: 'taskWorkspace',
                    }
                },
                {
                    $lookup: {
                        from: 'taskStatusList',
                        localField: 'taskStatusId',
                        foreignField: '_id',
                        as: 'taskStatusList',
                    }
                },
                {
                    $limit: 10,
                }
            ]);

            if (resultTasks.length === 0) {
                return '';
            }

            let taskStr = 'Below are tasks:\n\n';
            for (let index = 0; index < resultTasks.length; index++) {
                const element = resultTasks[index];
                taskStr += `Task ${index + 1} -> title -> ${element.title || ''}.\n`;
                taskStr += `Task ${index + 1} -> description -> ${element.description || ''}.\n`;
                taskStr += `Task ${index + 1} -> priority -> ${element.priority || ''}.\n`;
                taskStr += `Task ${index + 1} -> isCompleted -> ${element.isCompleted ? 'Yes' : 'No'}.\n`;

                if (element.taskWorkspace && element.taskWorkspace.length >= 1) {
                    taskStr += `Task ${index + 1} -> workspace -> ${element.taskWorkspace[0].title}.\n`;
                }
                if (element.taskStatusList && element.taskStatusList.length >= 1) {
                    taskStr += `Task ${index + 1} -> status -> ${element.taskStatusList[0].statusTitle}.\n`;
                }

                taskStr += '\n';
            }
            taskStr += '\n\n';

            return taskStr;
        } catch (error) {
            console.error('Error in getTasksContent:', error);
            return '';
        }
    }

    /**
     * Get notes content
     */
    private async getNotesContent(contextIds: mongoose.Types.ObjectId[]): Promise<string> {
        try {
            const resultNotes = await ModelNotes.aggregate([
                {
                    $match: {
                        username: this.username,
                        _id: { $in: contextIds },
                    }
                },
                {
                    $lookup: {
                        from: 'notesWorkspace',
                        localField: 'notesWorkspaceId',
                        foreignField: '_id',
                        as: 'notesWorkspaceArr',
                    }
                },
                {
                    $limit: 10,
                }
            ]);

            if (resultNotes.length === 0) {
                return '';
            }

            let noteStr = 'Below are notes:\n\n';
            for (let index = 0; index < resultNotes.length; index++) {
                const element = resultNotes[index];
                noteStr += `Note ${index + 1} -> title -> ${element.title || ''}.\n`;
                if (element.description && element.description.length > 0) {
                    const markdownContent = NodeHtmlMarkdown.translate(element.description);
                    noteStr += `Note ${index + 1} -> description -> ${markdownContent}.\n`;
                }
                if (element.notesWorkspaceArr && element.notesWorkspaceArr.length >= 1) {
                    noteStr += `Note ${index + 1} -> workspace -> ${element.notesWorkspaceArr[0].title}.\n`;
                }
                noteStr += '\n';
            }
            noteStr += '\n\n';

            return noteStr;
        } catch (error) {
            console.error('Error in getNotesContent:', error);
            return '';
        }
    }

    /**
     * Get life events content
     */
    private async getLifeEventsContent(contextIds: mongoose.Types.ObjectId[]): Promise<string> {
        try {
            const resultLifeEvents = await ModelLifeEvents.aggregate([
                {
                    $match: {
                        username: this.username,
                        _id: { $in: contextIds },
                    }
                },
                {
                    $limit: 10,
                }
            ]);

            if (resultLifeEvents.length === 0) {
                return '';
            }

            let lifeEventStr = 'Below are life events:\n\n';
            for (let index = 0; index < resultLifeEvents.length; index++) {
                const element = resultLifeEvents[index];
                if (element.title && element.title.length >= 1) {
                    lifeEventStr += `Life Event ${index + 1} -> title: ${element.title}.\n`;
                }
                if (element.description && element.description.length >= 1) {
                    const markdownContent = NodeHtmlMarkdown.translate(element.description);
                    lifeEventStr += `Life Event ${index + 1} -> description: ${markdownContent}.\n`;
                }
                if (element.eventDateUtc) {
                    lifeEventStr += `Life Event ${index + 1} -> event date: ${element.eventDateUtc}.\n`;
                }
                lifeEventStr += '\n';
            }
            lifeEventStr += '\n\n';

            return lifeEventStr;
        } catch (error) {
            console.error('Error in getLifeEventsContent:', error);
            return '';
        }
    }

    /**
     * Get info vault content
     */
    private async getInfoVaultContent(contextIds: mongoose.Types.ObjectId[]): Promise<string> {
        try {
            const resultInfoVault = await ModelInfoVault.aggregate([
                {
                    $match: {
                        username: this.username,
                        _id: { $in: contextIds },
                    }
                },
                {
                    $limit: 10,
                }
            ]);

            if (resultInfoVault.length === 0) {
                return '';
            }

            let infoVaultStr = 'Below are info vault items:\n\n';
            for (let index = 0; index < resultInfoVault.length; index++) {
                const element = resultInfoVault[index];
                if (element.title && element.title.length >= 1) {
                    infoVaultStr += `Info Vault ${index + 1} -> title: ${element.title}.\n`;
                }
                if (element.description && element.description.length >= 1) {
                    const markdownContent = NodeHtmlMarkdown.translate(element.description);
                    infoVaultStr += `Info Vault ${index + 1} -> description: ${markdownContent}.\n`;
                }
                infoVaultStr += '\n';
            }
            infoVaultStr += '\n\n';

            return infoVaultStr;
        } catch (error) {
            console.error('Error in getInfoVaultContent:', error);
            return '';
        }
    }

    /**
     * Step 4: Generate answer using context
     */
    async generateAnswer(contextContent: string): Promise<string> {
        try {
            if (!this.llmConfig || !this.question) {
                return '';
            }

            const conversationContext = await this.getConversationContext();

            let systemPrompt = 'You are a helpful AI assistant. Answer the user\'s question based on the provided context. If the context does not contain enough information to answer the question, say so clearly. Be concise and accurate.';
            
            let userPrompt = '';
            if (conversationContext) {
                userPrompt += `CONVERSATION CONTEXT:\n${conversationContext}\n\n`;
            }
            if (contextContent) {
                userPrompt += `RELEVANT CONTEXT:\n${contextContent}\n\n`;
            }
            userPrompt += `QUESTION: ${this.question}\n\nANSWER:`;

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

            const llmResult = await fetchLlmUnified({
                provider: this.llmConfig.provider,
                apiKey: this.llmConfig.apiKey,
                apiEndpoint: this.llmConfig.apiEndpoint,
                model: this.llmConfig.model,
                messages: llmMessages,
                temperature: 0.7,
                maxTokens: 4096,
                headersExtra: this.llmConfig.customHeaders,
            });

            if (!llmResult.success || !llmResult.content) {
                console.error('Failed to generate answer:', llmResult.error);
                return '';
            }

            return llmResult.content.trim();
        } catch (error) {
            console.error('Error in generateAnswer:', error);
            return '';
        }
    }

    /**
     * Main method: Execute full workflow
     */
    async execute(): Promise<{
        success: boolean;
        keywords: string[];
        contextIds: mongoose.Types.ObjectId[];
        answer: string;
        errorReason?: string;
    }> {
        try {
            // Initialize
            const initialized = await this.initialize();
            if (!initialized) {
                return {
                    success: false,
                    keywords: [],
                    contextIds: [],
                    answer: '',
                    errorReason: 'Failed to initialize or missing LLM config',
                };
            }

            // Step 1: Generate keywords
            const keywords = await this.generateKeywords();
            if (keywords.length === 0) {
                return {
                    success: false,
                    keywords: [],
                    contextIds: [],
                    answer: '',
                    errorReason: 'Failed to generate keywords',
                };
            }

            // Step 2: Search for context IDs
            const contextIds = await this.searchContextIds(keywords);

            // Step 3: Get context content
            const contextContent = await this.getContextContent(contextIds);

            // Step 4: Generate answer
            const answer = await this.generateAnswer(contextContent);
            if (!answer) {
                return {
                    success: false,
                    keywords,
                    contextIds,
                    answer: '',
                    errorReason: 'Failed to generate answer',
                };
            }

            return {
                success: true,
                keywords,
                contextIds,
                answer,
            };
        } catch (error) {
            console.error('Error in AnswerSubQuestion.execute:', error);
            return {
                success: false,
                keywords: [],
                contextIds: [],
                answer: '',
                errorReason: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
}

export default AnswerSubQuestion;
