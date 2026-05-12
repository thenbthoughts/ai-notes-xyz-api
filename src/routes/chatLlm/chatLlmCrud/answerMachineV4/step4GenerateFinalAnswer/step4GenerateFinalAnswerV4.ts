import mongoose from 'mongoose';

import { ModelAnswerMachineRequestV4 } from '../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineRequestV4.schema';
import { ModelAnswerMachineSubQuestionV4 } from '../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineSubQuestionV4.schema';
import { ModelChatLlm } from '../../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelChatLlmThread } from '../../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { IChatLlm } from '../../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types';
import fetchLlmUnified, { Message } from '../../../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { trackAnswerMachineTokens } from '../../answerMachineShared/tokenTracking';
import { getLlmConfig } from '../../answerMachineShared/answerMachineGetLlmConfig';

async function getConversationMessages(threadId: mongoose.Types.ObjectId, username: string): Promise<IChatLlm[]> {
    return (await ModelChatLlm.aggregate([
        { $match: { threadId, username, type: 'text' } },
        { $sort: { createdAtUtc: 1 } },
    ])) as IChatLlm[];
}

function formatConversationMessages(messages: IChatLlm[]): string {
    return messages
        .map((msg) => {
            const role = msg.isAi ? 'Assistant' : 'User';
            return `${role}: ${msg.content || ''}`;
        })
        .join('\n\n');
}

function formatIntermediateAnswers(intermediateAnswers: string[]): string {
    return intermediateAnswers
        .filter((a) => a && typeof a === 'string' && a.trim())
        .map((a, index) => `Intermediate ${index + 1}:\n${a.trim()}`)
        .join('\n\n');
}

const step4GenerateFinalAnswerV4 = async ({
    answerMachineRequestV4Id,
    abortSignal,
}: {
    answerMachineRequestV4Id: mongoose.Types.ObjectId;
    abortSignal?: AbortSignal;
}): Promise<{ success: boolean; errorReason: string; data: null }> => {
    try {
        const answerMachineRecord = await ModelAnswerMachineRequestV4.findById(answerMachineRequestV4Id);
        if (!answerMachineRecord) {
            return { success: false, errorReason: 'Answer Machine V4 request not found', data: null };
        }

        const threadId = answerMachineRecord.threadId;
        const username = answerMachineRecord.username;

        const thread = await ModelChatLlmThread.findOne({ _id: threadId, username });
        if (!thread) {
            return { success: false, errorReason: 'Thread not found', data: null };
        }

        const llmConfig = await getLlmConfig({ threadId });
        if (!llmConfig) {
            return { success: false, errorReason: 'Failed to get LLM configuration', data: null };
        }

        const conversationMessages = await getConversationMessages(threadId, username);
        const conversationText = formatConversationMessages(conversationMessages);

        const answeredSubQuestions = await ModelAnswerMachineSubQuestionV4.find({
            answerMachineRequestV4Id,
            status: 'answered',
        }).sort({ answerMachineIteration: 1, stepIndex: 1, createdAtUtc: 1 });

        const subQuestionsText = answeredSubQuestions
            .filter((sq) => sq.question && sq.answer)
            .map(
                (sq, index) =>
                    `Q${index + 1} (outer iter ${sq.answerMachineIteration}) [opencode]:\n${sq.question}\nA${index + 1}: ${sq.answer}`
            )
            .join('\n\n');

        const intermediateAnswersText = formatIntermediateAnswers(answerMachineRecord.intermediateAnswers || []);

        const globalLine = (answerMachineRecord.globalTaskDescription || '').trim()
            ? `GLOBAL TASK:\n${answerMachineRecord.globalTaskDescription.trim()}\n\n`
            : '';

        const systemPrompt =
            (thread.systemPrompt || '').trim() ||
            'You are a helpful AI assistant (Answer Machine 4, OpenCode-backed).';

        let userPrompt = globalLine;
        if (conversationText) userPrompt += `CONVERSATION HISTORY:\n${conversationText}\n\n`;
        if (subQuestionsText) userPrompt += `SEQUENTIAL REASONING STEPS (ordered):\n${subQuestionsText}\n\n`;
        if (intermediateAnswersText) {
            userPrompt += `INTERMEDIATE ANSWERS (previous iterations):\n${intermediateAnswersText}\n\n`;
        }
        userPrompt += `Produce one comprehensive final answer for the user's latest intent.\nFINAL ANSWER:`;

        const llmMessages: Message[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ];

        const llmResult = await fetchLlmUnified({
            provider: llmConfig.provider,
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: llmConfig.model,
            messages: llmMessages,
            temperature: thread.chatLlmTemperature ?? 0.7,
            maxTokens: thread.chatLlmMaxTokens ?? 4096,
            headersExtra: llmConfig.customHeaders,
            abortSignal,
        });

        if (!llmResult.success || !llmResult.content) {
            if (abortSignal?.aborted) {
                return { success: false, errorReason: 'Cancelled', data: null };
            }
            return { success: false, errorReason: 'Failed to generate final answer', data: null };
        }

        try {
            await trackAnswerMachineTokens(threadId, llmResult.usageStats, username, 'final_answer');
        } catch {
            /* empty */
        }

        const finalAnswer = llmResult.content.trim();

        await ModelAnswerMachineRequestV4.findByIdAndUpdate(answerMachineRequestV4Id, {
            $set: {
                finalAnswer,
                updatedAt: new Date(),
            },
        });

        return { success: true, errorReason: '', data: null };
    } catch (error) {
        console.error(`❌ AM4 step4 (request ${answerMachineRequestV4Id}):`, error);
        return {
            success: false,
            errorReason: error instanceof Error ? error.message : 'Internal server error',
            data: null,
        };
    }
};

export default step4GenerateFinalAnswerV4;
