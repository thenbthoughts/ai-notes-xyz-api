import mongoose from "mongoose";
import { ModelChatLlmAnswerMachine } from "../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaChatLlmAnswerMachine.schema";
import { ModelAnswerMachineSubQuestion } from "../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineSubQuestions.schema";
import { ModelGlobalSearch } from "../../../../../schema/schemaGlobalSearch/SchemaGlobalSearch.schema";
import { ModelChatLlm } from "../../../../../schema/schemaChatLlm/SchemaChatLlm.schema";
import { ModelTask } from "../../../../../schema/schemaTask/SchemaTask.schema";
import { ModelNotes } from "../../../../../schema/schemaNotes/SchemaNotes.schema";
import { ModelLifeEvents } from "../../../../../schema/schemaLifeEvents/SchemaLifeEvents.schema";
import { ModelInfoVault } from "../../../../../schema/schemaInfoVault/SchemaInfoVault.schema";
import { IChatLlm } from "../../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types";
import fetchLlmUnified, { Message } from "../../../../../utils/llmPendingTask/utils/fetchLlmUnified";
import { NodeHtmlMarkdown } from "node-html-markdown";
import { trackAnswerMachineTokens } from "../helperFunction/tokenTracking";
import { getLlmConfig, LlmConfig } from "../helperFunction/answerMachineGetLlmConfig";

interface RelevantContextResponse {
    relevantItems: {
        entityId: string;
        relevanceScore: number;
        relevanceReason: string;
    }[];
}

const step3AnswerSubQuestions = async ({
    answerMachineRecordId,
}: {
    answerMachineRecordId: mongoose.Types.ObjectId;
}): Promise<{
    success: boolean;
    errorReason: string;
    data: null;
}> => {
    try {
        console.log('step3AnswerSubQuestions', answerMachineRecordId);

        // Get the answer machine record to get thread info
        const answerMachineRecord = await ModelChatLlmAnswerMachine.findById(answerMachineRecordId);
        if (!answerMachineRecord) {
            return {
                success: false,
                errorReason: 'Answer machine record not found',
                data: null,
            };
        }

        const { threadId, username } = answerMachineRecord;

        // Find all pending sub-questions for this specific answer machine record
        const pendingSubQuestions = await ModelAnswerMachineSubQuestion.find({
            answerMachineRecordId,
            status: 'pending',
        });

        console.log(`Found ${pendingSubQuestions.length} pending sub-questions`);

        if (pendingSubQuestions.length === 0) {
            console.log('No pending sub-questions to answer');
            return {
                success: true,
                errorReason: '',
                data: null,
            };
        }

        // Answer each sub-question
        const answerPromises = pendingSubQuestions.map(async (subQuestion) => {
            try {
                console.log(`Answering sub-question: ${subQuestion._id}`);

                const result = await answerSubQuestionInline(subQuestion._id);

                if (!result.success) {
                    console.error(`Failed to answer sub-question ${subQuestion._id}:`, result.errorReason);

                    // Update sub-question status to error
                    await ModelAnswerMachineSubQuestion.findByIdAndUpdate(subQuestion._id, {
                        $set: {
                            status: 'error',
                            errorReason: result.errorReason || 'Failed to answer sub-question',
                        }
                    });

                    return { success: false, subQuestionId: subQuestion._id, error: result.errorReason };
                }

                // Update sub-question with answer and token data
                await ModelAnswerMachineSubQuestion.findByIdAndUpdate(subQuestion._id, {
                    $set: {
                        status: 'answered',
                        answer: result.answer,
                        contextIds: result.contextIds,
                        aiModelName: 'gpt-oss-20b', // Use the same model as in AnswerSubQuestion class
                        aiModelProvider: 'groq', // Default provider
                        promptTokens: result.tokens?.promptTokens || 0,
                        completionTokens: result.tokens?.completionTokens || 0,
                        reasoningTokens: result.tokens?.reasoningTokens || 0,
                        totalTokens: result.tokens?.totalTokens || 0,
                        costInUsd: result.tokens?.costInUsd || 0,
                    }
                });

                // Track tokens for answer machine
                if (result.tokens && subQuestion.threadId) {
                    await trackAnswerMachineTokens(
                        subQuestion.threadId,
                        result.tokens,
                        subQuestion.username,
                        'sub_question_answer'
                    );
                }

                console.log(`Successfully answered sub-question: ${subQuestion._id}`);
                return { success: true, subQuestionId: subQuestion._id };

            } catch (error) {
                console.error(`Error answering sub-question ${subQuestion._id}:`, error);

                // Update sub-question status to error
                await ModelAnswerMachineSubQuestion.findByIdAndUpdate(subQuestion._id, {
                    $set: {
                        status: 'error',
                        errorReason: error instanceof Error ? error.message : 'Unknown error',
                    }
                });

                return {
                    success: false,
                    subQuestionId: subQuestion._id,
                    error: error instanceof Error ? error.message : 'Unknown error'
                };
            }
        });

        // Wait for all sub-questions to be answered
        const results = await Promise.all(answerPromises);

        // Check if any failed
        const failedResults = results.filter(result => !result.success);
        if (failedResults.length > 0) {
            console.error(`Failed to answer ${failedResults.length} sub-questions`);
            return {
                success: false,
                errorReason: `Failed to answer ${failedResults.length} out of ${pendingSubQuestions.length} sub-questions`,
                data: null,
            };
        }

        console.log(`Successfully answered all ${pendingSubQuestions.length} sub-questions`);
        return {
            success: true,
            errorReason: '',
            data: null,
        };

    } catch (error) {
        console.error(`❌ Error in step3AnswerSubQuestions (answerMachineRecord ${answerMachineRecordId}):`, error);
        const errorMessage = error instanceof Error ? error.message : 'Internal server error';
        return {
            success: false,
            errorReason: errorMessage,
            data: null,
        };
    }
};

/**
 * Inline implementation of AnswerSubQuestion.execute()
 */
async function answerSubQuestionInline(subQuestionId: mongoose.Types.ObjectId): Promise<{
    success: boolean;
    keywords: string[];
    contextIds: mongoose.Types.ObjectId[];
    answer: string;
    errorReason?: string;
    tokens?: {
        promptTokens: number;
        completionTokens: number;
        reasoningTokens: number;
        totalTokens: number;
        costInUsd: number;
    };
}> {
    try {
        // Initialize sub-question data
        const initData = await initializeSubQuestion(subQuestionId);
        if (!initData) {
            return {
                success: false,
                keywords: [],
                contextIds: [],
                answer: '',
                errorReason: 'Failed to initialize sub-question',
            };
        }

        const { threadId, username, question, llmConfig } = initData;

        // Step 1: Generate keywords
        const keywords = await generateKeywordsInline(question, llmConfig, threadId, username);
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
        const contextIds = await searchContextIdsInline(keywords, threadId, username, llmConfig);

        // Step 3: Get context content
        const contextContent = await getContextContentInline(contextIds, username);

        // Step 4: Generate answer
        const answerResult = await generateAnswerInline(contextContent, question, threadId, username, llmConfig);
        if (!answerResult.answer) {
            return {
                success: false,
                keywords,
                contextIds,
                answer: '',
                errorReason: 'Failed to generate answer',
                tokens: answerResult.tokens,
            };
        }

        return {
            success: true,
            keywords,
            contextIds,
            answer: answerResult.answer,
            tokens: answerResult.tokens,
        };
    } catch (error) {
        console.error('Error in answerSubQuestionInline:', error);
        return {
            success: false,
            keywords: [],
            contextIds: [],
            answer: '',
            errorReason: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Initialize sub-question data
 */
async function initializeSubQuestion(subQuestionId: mongoose.Types.ObjectId): Promise<{
    threadId: mongoose.Types.ObjectId;
    username: string;
    question: string;
    llmConfig: LlmConfig;
} | null> {
    try {
        const subQuestion = await ModelAnswerMachineSubQuestion.findById(subQuestionId);
        if (!subQuestion) {
            return null;
        }

        const threadId = subQuestion.threadId;
        const username = subQuestion.username;
        const question = subQuestion.question || '';

        if (!threadId || !username || !question) {
            return null;
        }

        // Get LLM configuration
        const llmConfig = await getLlmConfig({ threadId });
        if (!llmConfig) {
            return null;
        }

        return {
            threadId,
            username,
            question,
            llmConfig,
        };
    } catch (error) {
        console.error('Error initializing sub-question:', error);
        return null;
    }
}


/**
 * Generate keywords from the sub-question
 */
async function generateKeywordsInline(question: string, llmConfig: LlmConfig, threadId: mongoose.Types.ObjectId, username: string): Promise<string[]> {
    try {
        const llmMessages: Message[] = [
            {
                role: 'system',
                content: 'You are a helpful assistant that extracts keywords from questions. Generate a JSON object with a "keywords" property containing an array of relevant SHORT keywords (around 10 keywords, each 1-3 words maximum) that summarize the main topics in the question. Keep keywords concise and specific. Example: {"keywords": ["API design", "database", "authentication"]}',
            },
            {
                role: 'user',
                content: `Extract around 10 SHORT keywords (1-3 words each) from the following question:\n\n${question}`,
            },
        ];

        const llmResult = await fetchLlmUnified({
            provider: llmConfig.provider,
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: llmConfig.model,
            messages: llmMessages,
            temperature: 0.7,
            maxTokens: 2048,
            responseFormat: 'json_object',
            headersExtra: llmConfig.customHeaders,
        });

        if (!llmResult.success || !llmResult.content) {
            console.error('Failed to generate keywords:', llmResult.error);
            return [];
        }

        // Track tokens for sub question answer (keyword extraction) using usageStats from fetchLlmUnified
        try {
            await trackAnswerMachineTokens(
                threadId,
                llmResult.usageStats,
                username,
                'sub_question_answer'
            );
        } catch (tokenError) {
            console.warn(`[Sub Question Answer - Keywords] Failed to track tokens:`, tokenError);
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
        console.error('Error in generateKeywordsInline:', error);
        return [];
    }
}

/**
 * Search for context IDs using keywords
 */
async function searchContextIdsInline(keywords: string[], threadId: mongoose.Types.ObjectId, username: string, llmConfig: LlmConfig): Promise<mongoose.Types.ObjectId[]> {
    try {
        if (keywords.length === 0) {
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
                    username: username,
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
        const scoredItems = await scoreContextReferencesInline(searchResults, keywords, threadId, username, llmConfig);

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
        console.error('Error in searchContextIdsInline:', error);
        return [];
    }
}

/**
 * Score context references with LLM
 */
async function scoreContextReferencesInline(
    searchResults: Array<{
        entityId: mongoose.Types.ObjectId;
        collectionName: string;
        text?: string;
    }>,
    keywords: string[],
    threadId: mongoose.Types.ObjectId,
    username: string,
    llmConfig: LlmConfig
): Promise<RelevantContextResponse['relevantItems']> {
    try {
        // Get conversation context
        const conversationContext = await getConversationContextInline(threadId, username);
        const questionContext = `Question: ${keywords.join(' ')}`;

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
            provider: llmConfig.provider,
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: llmConfig.model,
            messages: llmMessages,
            temperature: 0.2,
            maxTokens: 4096,
            responseFormat: 'json_object',
            headersExtra: llmConfig.customHeaders,
        });

        if (!llmResult.success || !llmResult.content) {
            console.error('Failed to score context references:', llmResult.error);
            return [];
        }

        // Track tokens for sub question answer (context scoring) using usageStats from fetchLlmUnified
        try {
            await trackAnswerMachineTokens(
                threadId,
                llmResult.usageStats,
                username,
                'sub_question_answer'
            );
        } catch (tokenError) {
            console.warn(`[Sub Question Answer - Context Scoring] Failed to track tokens:`, tokenError);
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
        console.error('Error in scoreContextReferencesInline:', error);
        return [];
    }
}

/**
 * Get conversation context from thread
 */
async function getConversationContextInline(threadId: mongoose.Types.ObjectId, username: string): Promise<string> {
    try {
        const lastMessages = await ModelChatLlm.aggregate([
            {
                $match: {
                    threadId: threadId,
                    username: username,
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
        console.error('Error in getConversationContextInline:', error);
        return '';
    }
}

/**
 * Get context content from IDs
 */
async function getContextContentInline(contextIds: mongoose.Types.ObjectId[], username: string): Promise<string> {
    try {
        if (contextIds.length === 0) {
            return '';
        }

        // Get context items from GlobalSearch to know their collection types
        const contextItems = await ModelGlobalSearch.find({
            username: username,
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
            contextContent += await getTasksContentInline(contextByCollection['tasks'], username);
        }

        // Get notes
        if (contextByCollection['notes'] && contextByCollection['notes'].length > 0) {
            contextContent += await getNotesContentInline(contextByCollection['notes'], username);
        }

        // Get life events
        if (contextByCollection['lifeEvents'] && contextByCollection['lifeEvents'].length > 0) {
            contextContent += await getLifeEventsContentInline(contextByCollection['lifeEvents'], username);
        }

        // Get info vault
        if (contextByCollection['infoVault'] && contextByCollection['infoVault'].length > 0) {
            contextContent += await getInfoVaultContentInline(contextByCollection['infoVault'], username);
        }

        return contextContent;
    } catch (error) {
        console.error('Error in getContextContentInline:', error);
        return '';
    }
}

/**
 * Get tasks content
 */
async function getTasksContentInline(contextIds: mongoose.Types.ObjectId[], username: string): Promise<string> {
    try {
        const resultTasks = await ModelTask.aggregate([
            {
                $match: {
                    username: username,
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
        console.error('Error in getTasksContentInline:', error);
        return '';
    }
}

/**
 * Get notes content
 */
async function getNotesContentInline(contextIds: mongoose.Types.ObjectId[], username: string): Promise<string> {
    try {
        const resultNotes = await ModelNotes.aggregate([
            {
                $match: {
                    username: username,
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
        console.error('Error in getNotesContentInline:', error);
        return '';
    }
}

/**
 * Get life events content
 */
async function getLifeEventsContentInline(contextIds: mongoose.Types.ObjectId[], username: string): Promise<string> {
    try {
        const resultLifeEvents = await ModelLifeEvents.aggregate([
            {
                $match: {
                    username: username,
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
        console.error('Error in getLifeEventsContentInline:', error);
        return '';
    }
}

/**
 * Get info vault content
 */
async function getInfoVaultContentInline(contextIds: mongoose.Types.ObjectId[], username: string): Promise<string> {
    try {
        const resultInfoVault = await ModelInfoVault.aggregate([
            {
                $match: {
                    username: username,
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
        console.error('Error in getInfoVaultContentInline:', error);
        return '';
    }
}

/**
 * Generate answer using context
 */
async function generateAnswerInline(
    contextContent: string,
    question: string,
    threadId: mongoose.Types.ObjectId,
    username: string,
    llmConfig: LlmConfig
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
        const conversationContext = await getConversationContextInline(threadId, username);

        let systemPrompt = 'You are a helpful AI assistant. Answer the user\'s question based on the provided context. If the context does not contain enough information to answer the question, say so clearly. Be concise and accurate.';

        let userPrompt = '';
        if (conversationContext) {
            userPrompt += `CONVERSATION CONTEXT:\n${conversationContext}\n\n`;
        }
        if (contextContent) {
            userPrompt += `RELEVANT CONTEXT:\n${contextContent}\n\n`;
        }
        userPrompt += `QUESTION: ${question}\n\nANSWER:`;

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
            provider: llmConfig.provider,
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: llmConfig.model,
            messages: llmMessages,
            temperature: 0.7,
            maxTokens: 4096,
            headersExtra: llmConfig.customHeaders,
        });

        if (!llmResult.success || !llmResult.content) {
            console.error('Failed to generate answer:', llmResult.error);
            return { answer: '' };
        }

        // Track tokens for sub question answer (final answer generation) using usageStats from fetchLlmUnified
        try {
            await trackAnswerMachineTokens(
                threadId,
                llmResult.usageStats,
                username,
                'sub_question_answer'
            );
        } catch (tokenError) {
            console.warn(`[Sub Question Answer - Final Answer] Failed to track tokens:`, tokenError);
        }

        return {
            answer: llmResult.content.trim(),
            tokens: llmResult.usageStats,
        };
    } catch (error) {
        console.error('Error in generateAnswerInline:', error);
        return { answer: '' };
    }
}

export default step3AnswerSubQuestions;