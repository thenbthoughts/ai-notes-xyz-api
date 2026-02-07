import mongoose from "mongoose";
import { ModelOpenaiCompatibleModel } from "../../../../schema/schemaUser/SchemaOpenaiCompatibleModel.schema";

import { ModelUserApiKey } from "../../../../schema/schemaUser/SchemaUserApiKey.schema";

import { ModelChatLlm } from "../../../../schema/schemaChatLlm/SchemaChatLlm.schema";
import { IChatLlm } from "../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types";

import { ModelChatLlmThread } from "../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema";
import { ModelChatLlmAnswerMachineTokenRecord } from "../../../../schema/schemaChatLlm/SchemaChatLlmAnswerMachineTokenRecord.schema";
import fetchLlmUnified, { Message } from "../../../../utils/llmPendingTask/utils/fetchLlmUnified";
import { ModelAnswerMachineSubQuestion } from "../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineSubQuestions.schema";
import { IAnswerMachineSubQuestion } from "../../../../types/typesSchema/typesChatLlm/typesAnswerMachine/SchemaAnswerMachineSubQuestions.types";
import AnswerSubQuestion from "./utils/AnswerSubQuestion";
import GenerateFinalAnswer from "./utils/GenerateFinalAnswer";
import completeAnswerMachine from "./utils/completeAnswerMachine";
import { 
    validateAndGetSettings, 
    updateThreadStatus, 
    checkIterationLimits, 
    shouldContinueIteration,
    handleLastMessageIsAi,
    handleNoQuestionsGenerated,
    getPreviousGaps
} from "./utils/answerMachineHelpers";
import { extractTokensFromRawResponse, calculateCostInUsd, aggregateTokens } from "./utils/tokenTracking";

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

/**
 * Get conversation messages for the thread
 */
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
        console.error(`❌ Error in step1GetConversation (thread ${threadId}):`, error);
        throw new Error(`Failed to get conversation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

const filterUnnecessaryQuestions = (
    questions: string[],
    conversationContent: string
): string[] => {
    try {
        if (questions.length === 0) {
        return [];
        }

        // Filter out generic/non-actionable questions
        const genericPatterns = [
            /what do you think/i,
            /can you tell me more/i,
            /what else/i,
            /anything else/i,
            /any other/i,
            /do you have/i,
            /are there/i,
            /tell me about/i,
        ];

        // Filter out formatting/presentation questions
        const formattingPatterns = [
            /format/i,
            /presentation/i,
            /display/i,
            /style/i,
            /design/i,
            /layout/i,
            /appearance/i,
            /look/i,
            /visual/i,
        ];

        let filtered = questions.filter(question => {
            const questionLower = question.toLowerCase().trim();

            // Skip empty questions
            if (questionLower.length === 0) {
                return false;
            }

            // Skip generic questions
            if (genericPatterns.some(pattern => pattern.test(questionLower))) {
                // But allow if it's specific enough (has more than just generic phrase)
                if (questionLower.length < 30) {
                    return false;
                }
            }

            // Skip formatting questions
            if (formattingPatterns.some(pattern => pattern.test(questionLower))) {
                return false;
            }

            // Check if question is already answered in conversation (simple keyword check)
            const questionKeywords = questionLower
                .split(/\s+/)
                .filter(word => word.length > 3)
                .slice(0, 3); // Get first 3 meaningful keywords

            if (questionKeywords.length > 0) {
                const conversationLower = conversationContent.toLowerCase();
                // If all keywords appear in conversation, might be redundant
                const allKeywordsInConversation = questionKeywords.every(keyword =>
                    conversationLower.includes(keyword)
                );
                // Only filter if it's a very short question or all keywords match
                if (allKeywordsInConversation && questionLower.length < 50) {
                    return false;
                }
            }

            return true;
        });

        // Deduplicate similar questions (simple approach)
        const uniqueQuestions: string[] = [];
        for (const question of filtered) {
            const questionLower = question.toLowerCase().trim();
            const isDuplicate = uniqueQuestions.some(existing => {
                const existingLower = existing.toLowerCase().trim();
                // Check if questions are very similar (80% word overlap)
                const questionWords = new Set(questionLower.split(/\s+/));
                const existingWords = new Set(existingLower.split(/\s+/));
                const intersection = new Set([...questionWords].filter(x => existingWords.has(x)));
                const union = new Set([...questionWords, ...existingWords]);
                const similarity = intersection.size / union.size;
                return similarity > 0.8;
            });

            if (!isDuplicate) {
                uniqueQuestions.push(question);
            }
        }

        // Limit to maximum 5 questions
        return uniqueQuestions.slice(0, 5);
    } catch (error) {
        console.error('❌ Error in filterUnnecessaryQuestions:', error);
        // Return original questions if filtering fails
        return questions.slice(0, 5);
    }
}

/**
 * Track tokens for answer machine - stores individual token records
 * Aggregated totals are calculated dynamically when needed
 */
export const trackAnswerMachineTokens = async (
    threadId: mongoose.Types.ObjectId,
    tokens: {
        promptTokens: number;
        completionTokens: number;
        reasoningTokens: number;
        totalTokens: number;
        costInUsd: number;
    },
    username: string,
    queryType?: 'question_generation' | 'sub_question_answer' | 'intermediate_answer' | 'evaluation' | 'final_answer'
): Promise<void> => {
    try {
        // Create individual token record for this execution
        if (queryType) {
            await ModelChatLlmAnswerMachineTokenRecord.create({
                threadId,
                username,
                queryType,
                promptTokens: tokens.promptTokens,
                completionTokens: tokens.completionTokens,
                reasoningTokens: tokens.reasoningTokens,
                totalTokens: tokens.totalTokens,
                costInUsd: tokens.costInUsd,
            });
        }
    } catch (error) {
        console.error(`[Token Tracking] Error tracking tokens for thread ${threadId}:`, error);
    }
};

const step2CreateQuestionDecompositionAndInsert = async ({
    threadId,
    currentIteration = 1,
    previousGaps = [],
    isContinuingForMinIterations = false,
}: {
    threadId: mongoose.Types.ObjectId;
    currentIteration?: number;
    previousGaps?: string[];
    isContinuingForMinIterations?: boolean;
}): Promise<{
    questions: string[];
    tokens?: {
        promptTokens: number;
        completionTokens: number;
        reasoningTokens: number;
        totalTokens: number;
        costInUsd: number;
    };
}> => {
    try {
        const thread = await ModelChatLlmThread.findById(threadId);
        if (!thread) {
            return { questions: [] };
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
            return { questions: [] };
        }

        const lastMessage = last10Messages[last10Messages.length - 1];
        if (!lastMessage) {
            console.log('No last message found');
            return { questions: [] };
        }
        const lastMessageId = lastMessage._id;

        // Prepare messages for LLM
        const messagesContent = last10Messages
            .filter(msg => msg.type === 'text' && msg.content)
            .map(msg => msg.content)
            .join('\n\n');

        if (!messagesContent || messagesContent.trim().length === 0) {
            return { questions: [] };
        }

        let systemPrompt = '';
        
        if (isContinuingForMinIterations && currentIteration > 1) {
            // Continuing for minimum iterations - generate questions to refine/improve the answer
            systemPrompt += `This is iteration ${currentIteration} of the answer machine.\n`;
            systemPrompt += `The previous answer was satisfactory, but we need to run at least ${currentIteration} iterations.\n`;
            systemPrompt += `Generate questions that could help refine, improve, or add depth to the answer.\n`;
            systemPrompt += `Focus on questions that might uncover additional context, edge cases, or improvements.\n`;
            systemPrompt += `Reply with a JSON object:\n`;
            systemPrompt += `{"missingRequirements": [refinement questions], "contextualQuestions": [], "implementationDetails": []}.\n`;
            systemPrompt += `Maximum 2-3 questions total. Use empty arrays if no meaningful improvements can be made.`;
        } else if (currentIteration > 1 && previousGaps.length > 0) {
            // Iteration 2+: Focus on gaps from previous answer
            systemPrompt += `This is iteration ${currentIteration} of the answer machine.\n`;
            systemPrompt += `The previous answer had the following gaps or unsatisfactory areas:\n`;
            systemPrompt += previousGaps.map((gap, i) => `${i + 1}. ${gap}`).join('\n');
            systemPrompt += `\n\nGenerate questions specifically to address these gaps and improve the answer quality.\n`;
            systemPrompt += `Focus ONLY on questions that will help fill these specific gaps.\n`;
            systemPrompt += `Reply with a JSON object:\n`;
            systemPrompt += `{"missingRequirements": [questions addressing the gaps], "contextualQuestions": [], "implementationDetails": []}.\n`;
            systemPrompt += `Maximum 3-5 questions total, only if truly needed to address the gaps. Use empty arrays if no questions are needed.`;
        } else {
            // Iteration 1: Standard question generation with improved filtering
            systemPrompt += `Given a user conversation, identify ONLY essential missing information required to solve the user's core problem. Be very selective - only ask questions that are absolutely necessary.\n`;
            systemPrompt += `Rules:\n`;
            systemPrompt += `1. Check if information is already mentioned in the conversation - if yes, don't ask\n`;
            systemPrompt += `2. Avoid generic questions that don't lead to actionable answers\n`;
            systemPrompt += `3. Exclude formatting, presentation, UI, or display preferences\n`;
            systemPrompt += `4. Prioritize questions that directly help solve the user's problem\n`;
            systemPrompt += `5. Maximum 3-5 total questions, only if truly essential\n`;
            systemPrompt += `Reply with a JSON object:\n`;
            systemPrompt += `{"missingRequirements": [essential questions only], "contextualQuestions": [0-1 if critical], "implementationDetails": [0-1 if critical]}.\n`;
            systemPrompt += `Use empty arrays if nothing is missing.`;
        }

        let userPrompt = '';
        if (isContinuingForMinIterations && currentIteration > 1) {
            userPrompt += `Analyze the conversation and the previous answer. Generate questions that could help refine or improve the answer:\n\n${messagesContent}`;
        } else if (currentIteration > 1 && previousGaps.length > 0) {
            userPrompt += `Analyze the conversation and the identified gaps above. Generate questions that will help gather information to address these specific gaps:\n\n${messagesContent}`;
        } else {
        userPrompt += `Analyze the following conversation and identify any missing requirements needed to solve the user's question.`;
        userPrompt += `Focus on information that is actually required but not provided:\n\n${messagesContent}`;
        }

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
            console.error(`[Question Generation] No LLM config found for user ${thread.username}`);
            return { questions: [] };
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

        // Extract token information
        const tokenInfo = extractTokensFromRawResponse(llmResult.raw);
        const costInUsd = calculateCostInUsd(
            tokenInfo.promptTokens,
            tokenInfo.completionTokens,
            tokenInfo.reasoningTokens,
            llmConfig.model,
            llmConfig.provider
        );

        if (!llmResult.success || !llmResult.content) {
            const errorMsg = `Failed to generate question decomposition: ${llmResult.error || 'Unknown error'}`;
            console.error(`[Question Generation] ${errorMsg}`);
            return { questions: [] };
        }

        console.log(`[Question Generation] LLM response received (length: ${llmResult.content.length}, tokens: ${tokenInfo.totalTokens})`);

        let parsed: any;
        try {
            parsed = JSON.parse(llmResult.content);
        } catch (err) {
            const errorMsg = `Failed to parse LLM result: ${err instanceof Error ? err.message : 'Unknown error'}`;
            console.error(`[Question Generation] ${errorMsg}. Content: ${llmResult.content.substring(0, 200)}...`);
            return { questions: [] };
        }

        // Updated keys according to current prompt and format
        let allQuestions: string[] = [];

        // Extract missing requirements
        if (parsed?.missingRequirements && Array.isArray(parsed.missingRequirements)) {
            allQuestions.push(...parsed.missingRequirements);
        }
        // Extract contextual questions (limit to 0-1)
        if (parsed?.contextualQuestions && Array.isArray(parsed.contextualQuestions)) {
            const contextualQuestions = parsed.contextualQuestions.slice(0, 1); // Limit to 1 max
            allQuestions.push(...contextualQuestions);
        }
        // Extract implementation details questions (limit to 0-1)
        if (parsed?.implementationDetails && Array.isArray(parsed.implementationDetails)) {
            const implementationQuestions = parsed.implementationDetails.slice(0, 1); // Limit to 1 max
            allQuestions.push(...implementationQuestions);
        }

        // Filter unnecessary questions
        allQuestions = filterUnnecessaryQuestions(allQuestions, messagesContent);

        // Fallback: nothing found, return empty
        if (allQuestions.length === 0) {
            return { questions: [] };
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

        const questions = subQuestions.map(subQuestion => subQuestion.question || '');
        
        return {
            questions,
            tokens: {
                ...tokenInfo,
                costInUsd,
            },
        };
    } catch (error) {
        console.error('❌ Error in step2CreateQuestionDecompositionAndInsert:', error);
        return { questions: [] };
    }
}

const step3AnswerSubQuestions = async ({
    threadId,
    username,
}: {
    threadId: mongoose.Types.ObjectId;
    username: string;
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
                    
                    // Track tokens from sub-question answering
                    if (result.tokens) {
                        await trackAnswerMachineTokens(threadId, result.tokens, username, 'sub_question_answer');
                    }
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
                const errorMsg = `Failed to process sub-question ${subQuestion._id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
                console.error(`[Answer Sub-Questions] ${errorMsg}`);
                // Update with error status
                try {
                await ModelAnswerMachineSubQuestion.findByIdAndUpdate(subQuestion._id, {
                    $set: {
                        status: 'error',
                        errorReason: error instanceof Error ? error.message : 'Unknown error',
                        updatedAtUtc: new Date(),
                    }
                });
                } catch (updateError) {
                    console.error(`[Answer Sub-Questions] Failed to update error status for ${subQuestion._id}:`, updateError);
                }
            }
        }
    } catch (error) {
        const errorMsg = `Error in step3AnswerSubQuestions: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(`[Answer Sub-Questions] ❌ ${errorMsg}`);
        // Don't throw - allow process to continue
    }
}

/**
 * Generate intermediate answer and store it (without creating a message)
 */
const generateAndStoreIntermediateAnswer = async ({
    threadId,
    username,
    currentIteration,
}: {
    threadId: mongoose.Types.ObjectId;
    username: string;
    currentIteration: number;
}): Promise<string> => {
    try {
        // Check if there are any answered sub-questions
        const answeredSubQuestions = await ModelAnswerMachineSubQuestion.find({
            threadId,
            username,
            status: 'answered',
        });

        // Only generate answer if there are answered sub-questions
        if (answeredSubQuestions.length === 0) {
            console.log(`[Intermediate Answer] Iteration ${currentIteration}: No answered sub-questions found, skipping`);
            return '';
        }

        // Create GenerateFinalAnswer instance and generate answer (without creating message)
        const generateFinalAnswer = new GenerateFinalAnswer(threadId, username);
        const initialized = await generateFinalAnswer.initialize();
        if (!initialized) {
            const errorMsg = `Iteration ${currentIteration}: Failed to initialize GenerateFinalAnswer`;
            console.error(`[Intermediate Answer] ${errorMsg}`);
            throw new Error(errorMsg);
        }

        const intermediateAnswerResult = await generateFinalAnswer.generateFinalAnswer();
        if (!intermediateAnswerResult.answer) {
            const errorMsg = `Iteration ${currentIteration}: Failed to generate intermediate answer`;
            console.error(`[Intermediate Answer] ${errorMsg}`);
            throw new Error(errorMsg);
        }

        // Track tokens from intermediate answer generation
        if (intermediateAnswerResult.tokens) {
            await trackAnswerMachineTokens(threadId, intermediateAnswerResult.tokens, username, 'intermediate_answer');
        }

        // Store intermediate answer in thread
        await ModelChatLlmThread.findByIdAndUpdate(threadId, {
            $push: {
                answerMachineIntermediateAnswers: intermediateAnswerResult.answer,
            }
        });

        console.log(`[Intermediate Answer] Iteration ${currentIteration}: Generated and stored (length: ${intermediateAnswerResult.answer.length})`);
        return intermediateAnswerResult.answer;
    } catch (error) {
        const errorMsg = `Failed to generate intermediate answer: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(`[Intermediate Answer] ❌ Error in iteration ${currentIteration}:`, errorMsg);
        // Return empty string but log the error - this allows the process to continue
        return '';
    }
}


const evaluateAnswerSatisfaction = async ({
    threadId,
    username,
    currentIteration,
}: {
    threadId: mongoose.Types.ObjectId;
    username: string;
    currentIteration: number;
}): Promise<{
    isSatisfactory: boolean;
    gaps: string[];
    reasoning: string;
}> => {
    try {
        // Get conversation messages
        const conversationMessages = await ModelChatLlm.find({
            threadId,
            username,
            type: 'text',
        }).sort({ createdAtUtc: 1 });

        if (conversationMessages.length === 0) {
            return {
                isSatisfactory: false,
                gaps: ['No conversation found'],
                reasoning: 'No conversation messages available',
            };
        }

        // Get the last user message (the original question)
        const lastUserMessage = conversationMessages
            .filter(msg => !msg.isAi)
            .slice(-1)[0];

        if (!lastUserMessage) {
            return {
                isSatisfactory: true,
                gaps: [],
                reasoning: 'Missing user question',
            };
        }

        // Get the intermediate answer from the thread (not from conversation messages)
        const thread = await ModelChatLlmThread.findById(threadId);
        if (!thread) {
            return {
                isSatisfactory: true,
                gaps: [],
                reasoning: 'Thread not found',
            };
        }

        // Get the latest intermediate answer (the one we just generated)
        const intermediateAnswers = thread.answerMachineIntermediateAnswers || [];
        const latestIntermediateAnswer = intermediateAnswers[intermediateAnswers.length - 1];

        if (!latestIntermediateAnswer) {
            return {
                isSatisfactory: true,
                gaps: [],
                reasoning: 'No intermediate answer found for evaluation',
            };
        }

        // Get LLM configuration
        const llmConfig = await getLlmConfigForThread({
            username,
        });

        if (!llmConfig) {
            return {
                isSatisfactory: true,
                gaps: [],
                reasoning: 'LLM config not available, assuming satisfactory',
            };
        }

        // Prepare conversation context
        const conversationText = conversationMessages
            .map(msg => `${msg.isAi ? 'Assistant' : 'User'}: ${msg.content || ''}`)
            .join('\n\n');

        // Build evaluation prompt
        const systemPrompt = `You are an AI assistant that evaluates answer quality. Evaluate if the generated answer adequately addresses the user's question.
Consider: completeness, accuracy, relevance, and whether critical information is missing.
Return a JSON object with:
- "isSatisfactory": boolean (true if answer is complete and satisfactory, false if gaps exist)
- "gaps": array of strings (specific gaps or missing information, empty array if satisfactory)
- "reasoning": string (brief explanation of your evaluation)

Be strict but fair. Only mark as unsatisfactory if there are clear gaps that prevent a complete answer.`;

        const userPrompt = `CONVERSATION:\n${conversationText}\n\nORIGINAL USER QUESTION:\n${lastUserMessage.content}\n\nGENERATED ANSWER (Iteration ${currentIteration}):\n${latestIntermediateAnswer}\n\nEvaluate if the answer is satisfactory and identify any gaps.`;

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

        // Call LLM for evaluation
        const llmResult = await fetchLlmUnified({
            provider: llmConfig.provider,
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: llmConfig.model,
            messages: llmMessages,
            temperature: 0.3,
            maxTokens: 2048,
            responseFormat: 'json_object',
            headersExtra: llmConfig.customHeaders,
        });

        // Extract and track token information
        const tokenInfo = extractTokensFromRawResponse(llmResult.raw);
        const costInUsd = calculateCostInUsd(
            tokenInfo.promptTokens,
            tokenInfo.completionTokens,
            tokenInfo.reasoningTokens,
            llmConfig.model,
            llmConfig.provider
        );
        
        // Track tokens from evaluation
        await trackAnswerMachineTokens(threadId, {
            ...tokenInfo,
            costInUsd,
        }, username, 'evaluation');

        if (!llmResult.success || !llmResult.content) {
            const errorMsg = `Failed to evaluate answer satisfaction: ${llmResult.error || 'Unknown error'}`;
            console.error(`[Evaluation] ${errorMsg}`);
            // Default to satisfactory if evaluation fails to prevent infinite loops
            return {
                isSatisfactory: true,
                gaps: [],
                reasoning: `Evaluation failed: ${llmResult.error || 'Unknown error'}`,
            };
        }

        try {
            const parsed = JSON.parse(llmResult.content);
            const result = {
                isSatisfactory: parsed.isSatisfactory === true,
                gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [],
                reasoning: parsed.reasoning || 'No reasoning provided',
            };
            console.log(`[Evaluation] Parsed result: satisfactory=${result.isSatisfactory}, gaps=${result.gaps.length}`);
            return result;
        } catch (parseError) {
            const errorMsg = `Failed to parse evaluation JSON: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`;
            console.error(`[Evaluation] ${errorMsg}. Content: ${llmResult.content.substring(0, 200)}...`);
            return {
                isSatisfactory: true,
                gaps: [],
                reasoning: `Parse error: ${errorMsg}`,
            };
        }
    } catch (error) {
        const errorMsg = `Error in evaluateAnswerSatisfaction: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(`[Evaluation] ❌ ${errorMsg}`);
        return {
            isSatisfactory: true,
            gaps: [],
            reasoning: `Exception: ${errorMsg}`,
        };
    }
}

const answerMachineFunc = async ({
    threadId,
    username,
    previousGapsFromEvaluation,
}: {
    threadId: mongoose.Types.ObjectId;
    username: string;
    previousGapsFromEvaluation?: string[];
}): Promise<{
    success: boolean;
    errorReason: string;
    data: null;
}> => {
    try {
        // Validate and get settings
        const settings = await validateAndGetSettings(threadId);
        if (!settings.success || !settings.thread || settings.minIterations === undefined || 
            settings.maxIterations === undefined || settings.currentIteration === undefined) {
            const errorReason = settings.errorReason || 'Validation failed or missing settings';
            await updateThreadStatus(threadId, 'error', {
                errorReason,
            });
            return {
                success: false,
                errorReason,
                data: null,
            };
        }

        const { thread, minIterations, maxIterations, currentIteration } = settings;

        // Check iteration limits
        const limits = checkIterationLimits(currentIteration, minIterations, maxIterations);

        // If we've exceeded max iterations, complete immediately
        if (currentIteration > maxIterations) {
            await completeAnswerMachine({ threadId, username });
            return {
                success: true,
                errorReason: 'Max iterations reached',
                data: null,
            };
        }

        // Update thread iteration and status
        await updateThreadStatus(threadId, 'pending', {
            currentIteration,
        });

        // Get conversation
        let conversationList: IChatLlm[];
        try {
            conversationList = await step1GetConversation({
            threadId,
            username,
        });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to get conversation';
            await updateThreadStatus(threadId, 'error', {
                errorReason: errorMessage,
            });
            return {
                success: false,
                errorReason: errorMessage,
                data: null,
            };
        }

        if (conversationList.length === 0) {
            await updateThreadStatus(threadId, 'error', {
                errorReason: 'No conversation found',
            });
            return {
                success: false,
                errorReason: 'No conversation found',
                data: null,
            };
        }

        // Handle case where last message is already AI (iteration 1 only)
        const lastMessageCheck = await handleLastMessageIsAi(
            currentIteration,
            conversationList,
            limits,
            minIterations
        );
        
        if (lastMessageCheck.shouldHandle) {
            if (lastMessageCheck.shouldComplete) {
                await completeAnswerMachine({ threadId, username });
            return {
                success: false,
                errorReason: 'Last conversation is ai',
                data: null,
            };
            } else {
                console.log(`Iteration ${currentIteration}: Last message is AI but minimum iterations (${minIterations}) not reached, continuing`);
                const nextIterationResult = await answerMachineFunc({
                    threadId,
                    username,
                    previousGapsFromEvaluation: [],
                });
                return nextIterationResult;
            }
        }

        // Get previous gaps if iteration > 1
        const gapsInfo = getPreviousGaps(currentIteration, previousGapsFromEvaluation);
        let previousGaps = gapsInfo.previousGaps;
        let isContinuingForMinIterations = gapsInfo.isContinuingForMinIterations;
        
        // If we need to evaluate previous iteration, do it now
        if (gapsInfo.needsEvaluation) {
            const lastAiMessage = conversationList
                .filter(msg => msg.isAi)
                .slice(-1)[0];
            
            if (lastAiMessage) {
                const evaluation = await evaluateAnswerSatisfaction({
                    threadId,
                    username,
                    currentIteration: currentIteration - 1,
                });
                previousGaps = evaluation.gaps;
                console.log(`Iteration ${currentIteration}: Previous gaps identified:`, previousGaps);
            }
        } else if (previousGaps.length === 0 && currentIteration > 1) {
            console.log(`Iteration ${currentIteration}: Continuing for minimum iterations (no gaps)`);
        } else if (previousGaps.length > 0) {
            console.log(`Iteration ${currentIteration}: Using gaps from previous evaluation:`, previousGaps);
        }

        // create question decomposition (with iteration and gaps info)
        const questionDecompositionResult = await step2CreateQuestionDecompositionAndInsert({
            threadId,
            currentIteration,
            previousGaps,
            isContinuingForMinIterations,
        });
        const questionDecomposition = questionDecompositionResult.questions;
        
        // Track tokens from question generation
        if (questionDecompositionResult.tokens) {
            const thread = await ModelChatLlmThread.findById(threadId);
            if (thread) {
                await trackAnswerMachineTokens(threadId, questionDecompositionResult.tokens, thread.username, 'question_generation');
            }
        }
        
        console.log(`Iteration ${currentIteration} - questionDecomposition:`, questionDecomposition);

        // Handle case where no questions are generated
        if (questionDecomposition.length === 0) {
            if (currentIteration === 1) {
                const noQuestionsCheck = await handleNoQuestionsGenerated(
                    currentIteration,
                    threadId,
                    username,
                    limits,
                    minIterations
                );

                if (noQuestionsCheck.shouldComplete) {
                    console.log(`Iteration ${currentIteration}: No questions needed and minimum iterations (${minIterations}) reached, completing`);
                    await completeAnswerMachine({ threadId, username });
                    return {
                        success: true,
                        errorReason: 'No questions needed',
                        data: null,
                    };
                } else {
                    console.log(`Iteration ${currentIteration}: No questions needed but minimum iterations (${minIterations}) not reached, continuing`);
                    // Continue to generate intermediate answer and evaluate
                }
            } else {
                // In iteration 2+, if no new questions generated, gaps might not be addressable with questions
                // Still try to improve final answer with all existing context
                console.log(`Iteration ${currentIteration}: No new questions generated, will attempt to improve final answer with existing context`);
            }
        }

        // answer sub-questions (only if there are pending questions)
        await step3AnswerSubQuestions({
            threadId,
            username,
        });

        // Generate intermediate answer and store it (don't create message yet)
        // This will use all answered sub-questions from all iterations
        const intermediateAnswer = await generateAndStoreIntermediateAnswer({
            threadId,
            username,
            currentIteration,
        });

        // Evaluate satisfaction and decide next step
        if (limits.shouldContinue) {
            const evaluation = await evaluateAnswerSatisfaction({
                threadId,
                username,
                currentIteration,
            });

            console.log(`Iteration ${currentIteration} evaluation:`, {
                isSatisfactory: evaluation.isSatisfactory,
                gaps: evaluation.gaps,
                reasoning: evaluation.reasoning,
            });

            // Decide if we should continue
            const decision = shouldContinueIteration(evaluation, limits);
            
            if (decision.shouldContinue) {
                // Continue to next iteration
                console.log(`Iteration ${currentIteration}: ${decision.reason}, continuing to iteration ${currentIteration + 1}`);
                
                const nextIterationResult = await answerMachineFunc({
                    threadId,
                    username,
                    previousGapsFromEvaluation: evaluation.gaps.length > 0 ? evaluation.gaps : [],
                });
                
                return nextIterationResult;
            } else {
                // Stop and complete
                console.log(`Iteration ${currentIteration}: ${decision.reason}, completing`);
                await completeAnswerMachine({ threadId, username });
                return {
                    success: true,
                    errorReason: '',
                    data: null,
                };
            }
        } else {
            // Max iterations reached, complete
            console.log(`Max iterations (${maxIterations}) reached, completing`);
            await completeAnswerMachine({ threadId, username });
        return {
            success: true,
            errorReason: '',
            data: null,
        };
        }
    } catch (error) {
        console.error(`❌ Error in answerMachineFunc (thread ${threadId}):`, error);
        const errorMessage = error instanceof Error ? error.message : 'Internal server error';
        
        try {
            await updateThreadStatus(threadId, 'error', {
                errorReason: errorMessage,
            });
        } catch (updateError) {
            console.error('Failed to update thread error status:', updateError);
        }
        
        return {
            success: false,
            errorReason: errorMessage,
            data: null,
        };
    }

};

export default answerMachineFunc;