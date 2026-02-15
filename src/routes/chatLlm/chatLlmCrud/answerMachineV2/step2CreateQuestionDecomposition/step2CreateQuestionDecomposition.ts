import mongoose from "mongoose";
import { ModelChatLlmAnswerMachine } from "../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaChatLlmAnswerMachine.schema";
import { ModelChatLlm } from "../../../../../schema/schemaChatLlm/SchemaChatLlm.schema";
import { IChatLlm } from "../../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types";
import fetchLlmUnified, { Message } from "../../../../../utils/llmPendingTask/utils/fetchLlmUnified";
import { ModelAnswerMachineSubQuestion } from "../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineSubQuestions.schema";

import { getLlmConfig } from "../helperFunction/answerMachineGetLlmConfig";
import { trackAnswerMachineTokens } from "../helperFunction/tokenTracking";

const step2CreateQuestionDecomposition = async ({
    answerMachineRecordId,
}: {
    answerMachineRecordId: mongoose.Types.ObjectId;
}): Promise<{
    success: boolean;
    errorReason: string;
    data: null;
}> => {
    try {
        // Get the answer machine record
        const answerMachineRecord = await ModelChatLlmAnswerMachine.findById(answerMachineRecordId);
        if (!answerMachineRecord) {
            return {
                success: false,
                errorReason: 'Answer machine record not found',
                data: null,
            };
        }

        const { threadId, username, currentIteration } = answerMachineRecord;

        // Get last 10 messages from the thread
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
            return {
                success: false,
                errorReason: 'No messages found in thread',
                data: null,
            };
        }

        const lastMessage = last10Messages[last10Messages.length - 1];
        if (!lastMessage) {
            return {
                success: false,
                errorReason: 'No last message found',
                data: null,
            };
        }

        // Prepare messages for LLM
        const messagesContent = last10Messages
            .filter(msg => msg.type === 'text' && msg.content)
            .map(msg => msg.content)
            .join('\n\n');

        if (!messagesContent || messagesContent.trim().length === 0) {
            return {
                success: false,
                errorReason: 'No valid message content found',
                data: null,
            };
        }

        // Get previous gaps if available
        const intermediateAnswers = answerMachineRecord.intermediateAnswers || [];

        // Build system prompt based on iteration and context
        let systemPrompt = '';

        if (currentIteration > 1) {
            // Iteration 2+: Focus on gaps from previous answer
            systemPrompt += `This is iteration ${currentIteration} of the answer machine.\n`;
            if (intermediateAnswers.length > 0) {
                systemPrompt += `The previous answer had the following gaps or unsatisfactory areas:\n`;
                systemPrompt += intermediateAnswers.map((answer: string, i: number) => `${i + 1}. ${answer}`).join('\n');
            }
            systemPrompt += `\n\nGenerate detailed, keyword-rich questions specifically to address these gaps and improve the answer quality.\n`;
            systemPrompt += `Focus ONLY on questions that will help fill these specific gaps.\n`;
            systemPrompt += `Make each question comprehensive and specific, including relevant keywords and technical terms that will help search and retrieve relevant context from documents, notes, and knowledge base.\n`;
            systemPrompt += `Explore various related keywords, synonyms, alternative terms, and different phrasings to maximize context retrieval: include technical jargon, brand names, abbreviations, industry terms, and related concepts that might be documented under different names.\n`;
            systemPrompt += `Reply with a JSON object:\n`;
            systemPrompt += `{"missingRequirements": [detailed questions with keywords addressing the gaps], "contextualQuestions": [], "implementationDetails": []}.\n`;
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
            systemPrompt += `6. Make each question detailed and keyword-rich, including specific technical terms, product names, concepts, and search terms that will help retrieve relevant context from documents and knowledge base\n`;
            systemPrompt += `7. Structure questions to be comprehensive enough to generate meaningful search queries for finding related information\n`;
            systemPrompt += `8. Include various related keywords, synonyms, alternative terms, and different phrasings of the same concepts to maximize context retrieval efficiency\n`;
            systemPrompt += `9. Consider multiple search angles: technical terms, brand names, common abbreviations, industry jargon, and related concepts that users might have documented under different names\n`;
            systemPrompt += `Reply with a JSON object:\n`;
            systemPrompt += `{"missingRequirements": [detailed keyword-rich questions], "contextualQuestions": [0-1 if critical], "implementationDetails": [0-1 if critical]}.\n`;
            systemPrompt += `Use empty arrays if nothing is missing.`;
        }

        let userPrompt = '';
        if (currentIteration > 1) {
            userPrompt += `Analyze the conversation and the identified gaps above. Generate detailed, keyword-rich questions that will help gather information to address these specific gaps. Each question should be comprehensive and explore various related keywords, synonyms, technical terms, brand names, abbreviations, and alternative phrasings that will efficiently retrieve context from documents, notes, tasks, and knowledge base:\n\n${messagesContent}`;
        } else {
            userPrompt += `Analyze the following conversation and identify any missing requirements needed to solve the user's question.`;
            userPrompt += `Focus on information that is actually required but not provided. Make each question detailed and keyword-rich, exploring various related keywords, synonyms, technical terms, brand names, abbreviations, and alternative phrasings that will help search and retrieve relevant context efficiently from all available sources:\n\n${messagesContent}`;
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
        const llmConfig = await getLlmConfig({
            threadId,
        });

        if (!llmConfig) {
            console.error(`[Question Generation] No LLM config found for thread ${threadId}`);
            return {
                success: false,
                errorReason: 'No LLM configuration found',
                data: null,
            };
        }

        // Call fetchLlmUnified
        const llmResult = await fetchLlmUnified({
            provider: llmConfig.provider,
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: llmConfig.model,
            messages: llmMessages,
            temperature: 0.3,
            maxTokens: 4096,
            responseFormat: 'json_object',
            headersExtra: llmConfig.customHeaders,
        });

        if (!llmResult.success || !llmResult.content) {
            const errorMsg = `Failed to generate questions: ${llmResult.error || 'Unknown error'}`;
            console.error(`[Question Generation] ${errorMsg}`);
            return {
                success: false,
                errorReason: errorMsg,
                data: null,
            };
        }

        // Track tokens for question generation using usageStats from fetchLlmUnified
        try {
            await trackAnswerMachineTokens(
                threadId,
                llmResult.usageStats,
                username,
                'question_generation'
            );
        } catch (tokenError) {
            console.warn(`[Question Generation] Failed to track tokens:`, tokenError);
        }

        // Parse the JSON response
        let parsedQuestions: {
            missingRequirements?: string[];
            contextualQuestions?: string[];
            implementationDetails?: string[];
        };

        try {
            parsedQuestions = JSON.parse(llmResult.content);
        } catch (parseError) {
            const errorMsg = `Failed to parse question JSON: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`;
            console.error(`[Question Generation] ${errorMsg}. Content: ${llmResult.content.substring(0, 200)}...`);
            return {
                success: false,
                errorReason: errorMsg,
                data: null,
            };
        }

        // Combine all questions
        const allQuestions = [
            ...(parsedQuestions.missingRequirements || []),
            ...(parsedQuestions.contextualQuestions || []),
            ...(parsedQuestions.implementationDetails || []),
        ];

        // Filter unnecessary questions
        console.log(`[Question Generation] Iteration ${currentIteration}: Generated ${allQuestions.length} questions`);

        // Insert sub-questions into database
        if (allQuestions.length > 0) {
            const insertManyArr = allQuestions.map((question, index) => ({
                threadId,
                parentMessageId: answerMachineRecord.parentMessageId,
                
                username,
                answerMachineRecordId,
                question,
                answer: '',
                status: 'pending' as const,
                questionOrder: index,
                answerMachineIteration: currentIteration,
            }));

            await ModelAnswerMachineSubQuestion.insertMany(insertManyArr);
            console.log(`[Question Generation] Inserted ${insertManyArr.length} sub-questions for iteration ${currentIteration}`);
        }

        return {
            success: true,
            errorReason: '',
            data: null,
        };
    } catch (error) {
        console.error(`❌ Error in step2CreateQuestionDecomposition (answerMachineRecord ${answerMachineRecordId}):`, error);
        const errorMessage = error instanceof Error ? error.message : 'Internal server error';
        return {
            success: false,
            errorReason: errorMessage,
            data: null,
        };
    }
};

export default step2CreateQuestionDecomposition;