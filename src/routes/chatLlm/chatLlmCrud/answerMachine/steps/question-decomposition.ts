import mongoose from "mongoose";
import { SubQuestionRepository } from "../database/sub-question-repository";
import { AnswerMachineRepository } from "../database/answer-machine-repository";
// Simplified question decomposition

/**
 * Filter out unnecessary questions from the generated list
 */
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
};

/**
 * Step 2: Create question decomposition and insert sub-questions
 */
export const step2QuestionDecomposition = async ({
    answerMachineId,
    threadId,
    username,
    currentIteration = 1,
    previousGaps = [],
    isContinuingForMinIterations = false,
}: {
    answerMachineId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    username: string;
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
        console.log(`[Question Decomposition] Simplified generation for iteration ${currentIteration}`);

        // Generate multiple questions based on iteration and previous gaps
        const questions: string[] = [];

        if (currentIteration === 1) {
            // Initial questions to understand the topic
            questions.push('What is the main topic of this conversation?');
            questions.push('What specific information is needed to provide a complete answer?');
            questions.push('What are the key requirements or constraints mentioned?');
            questions.push('What is the context or background information provided?');
        } else if (previousGaps.length > 0) {
            // Generate questions based on previous gaps identified
            questions.push(`Can you provide more details about: ${previousGaps[0] || 'the topic'}?`);

            // Generate additional follow-up questions based on gaps
            if (previousGaps.length > 1) {
                questions.push(`What additional information is needed regarding: ${previousGaps[1]}?`);
            }

            // Always generate at least 2-3 questions per iteration for deeper analysis
            questions.push(`How does this relate to the broader context of: ${previousGaps[0] || 'the main topic'}?`);
            questions.push(`What are the implications or consequences of: ${previousGaps[0] || 'this aspect'}?`);
        } else {
            // Fallback questions if no specific gaps
            questions.push(`What additional analysis is needed for iteration ${currentIteration}?`);
            questions.push(`What other perspectives should be considered?`);
            questions.push(`What are the potential limitations or caveats?`);
        }

        // Ensure we have at least 3 questions per iteration for comprehensive analysis
        while (questions.length < 3) {
            questions.push(`Additional question ${questions.length + 1} for iteration ${currentIteration}?`);
        }

        // Limit to maximum 5 questions per iteration to avoid overwhelming
        questions.splice(5);

        // Simplified token tracking
        const tokens = {
            promptTokens: 100,
            completionTokens: 50,
            reasoningTokens: 0,
            totalTokens: 150,
            costInUsd: 0.0001,
        };

        console.log(`✅ Generated ${questions.length} simplified questions for iteration ${currentIteration}`);

        // Create sub-questions in database
        if (questions.length > 0) {
            // Get the Answer Machine record to get the parent message ID
            const answerMachineRecord = await AnswerMachineRepository.findById(answerMachineId);
            if (!answerMachineRecord) {
                console.error(`❌ Answer Machine record not found: ${answerMachineId}`);
                return { questions: [] };
            }

            const subQuestions = questions.map(question => ({
                answerMachineId,
                threadId,
                parentMessageId: answerMachineRecord.parentMessageId,
                username,
                question,
                status: 'pending' as const,
                answer: '',
                keywords: [],
            }));

            await SubQuestionRepository.createMany(subQuestions);
            console.log(`✅ Created ${questions.length} sub-questions in database`);
        }

        return { questions, tokens };
    } catch (error) {
        console.error('❌ Error in step2QuestionDecomposition:', error);
        return { questions: [] };
    }
};