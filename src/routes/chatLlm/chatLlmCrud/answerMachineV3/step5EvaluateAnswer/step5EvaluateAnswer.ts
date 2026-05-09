import mongoose from 'mongoose';

import { ModelAnswerMachineRequestV3 } from '../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineRequestV3.schema';
import { ModelAnswerMachineSubQuestionV3 } from '../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineSubQuestionV3.schema';
import { ModelAnswerMachineEvaluateAnswerV3 } from '../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineEvaluateAnswerV3.schema';
import { ModelChatLlm } from '../../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelChatLlmAnswerMachineTokenRecord } from '../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaChatLlmAnswerMachineTokenRecord.schema';
import { IChatLlm } from '../../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types';
import fetchLlmUnified, { Message } from '../../../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { trackAnswerMachineTokens } from '../../answerMachineV2/helperFunction/tokenTracking';
import { getLlmConfig, LlmConfig } from '../../answerMachineV2/helperFunction/answerMachineGetLlmConfig';

interface EvaluationResult {
    isSatisfactory: boolean;
    reason: string;
    confidence: number;
    allImpliedSubtasksDone: boolean;
    finalAnswerDeliverable: boolean;
    globalTaskChecklist: string;
    cancelled?: boolean;
}

async function createFinalAnswerMessageWithTokens(
    finalAnswer: string,
    threadId: mongoose.Types.ObjectId,
    username: string,
    llmConfig: LlmConfig | null
): Promise<mongoose.Types.ObjectId | null> {
    try {
        if (!finalAnswer?.trim()) {
            return null;
        }

        const tokenRecords = await ModelChatLlmAnswerMachineTokenRecord.find({ threadId });

        let finalTokens = {
            promptTokens: 0,
            completionTokens: 0,
            reasoningTokens: 0,
            totalTokens: 0,
            costInUsd: 0,
        };

        tokenRecords.forEach((record) => {
            finalTokens.promptTokens += record.promptTokens || 0;
            finalTokens.completionTokens += record.completionTokens || 0;
            finalTokens.reasoningTokens += record.reasoningTokens || 0;
            finalTokens.totalTokens += record.totalTokens || 0;
            finalTokens.costInUsd += record.costInUsd || 0;
        });

        const newMessage = await ModelChatLlm.create({
            type: 'text',
            content: finalAnswer,
            username,
            threadId,
            isAi: true,
            tags: [],
            aiModelProvider: llmConfig?.provider || '',
            aiModelName: llmConfig?.model || '',
            promptTokens: finalTokens.promptTokens || 0,
            completionTokens: finalTokens.completionTokens || 0,
            reasoningTokens: finalTokens.reasoningTokens || 0,
            totalTokens: finalTokens.totalTokens || 0,
            costInUsd: finalTokens.costInUsd || 0,
            createdAtUtc: new Date(),
            updatedAtUtc: new Date(),
        });

        return newMessage._id as mongoose.Types.ObjectId;
    } catch (error) {
        console.error('createFinalAnswerMessageWithTokens AM3:', error);
        return null;
    }
}

const evaluateFinalAnswer = async (
    finalAnswer: string,
    llmConfig: LlmConfig,
    threadId: mongoose.Types.ObjectId,
    username: string,
    answerMachineRequestV3Id: mongoose.Types.ObjectId,
    globalTaskDescription: string,
    abortSignal?: AbortSignal
): Promise<EvaluationResult> => {
    if (!finalAnswer?.trim()) {
        return {
            isSatisfactory: false,
            reason: 'Final answer is empty',
            confidence: 0,
            allImpliedSubtasksDone: false,
            finalAnswerDeliverable: false,
            globalTaskChecklist: '',
        };
    }

    try {
        const last10Messages = (await ModelChatLlm.aggregate([
            { $match: { threadId, username, type: 'text' } },
            { $sort: { createdAtUtc: -1 } },
            { $limit: 10 },
            { $sort: { createdAtUtc: 1 } },
        ])) as IChatLlm[];

        const conversationContext = last10Messages
            .map((msg) => msg.content)
            .filter((c) => typeof c === 'string' && c.trim())
            .join('\n')
            .trim();

        const subQuestions = await ModelAnswerMachineSubQuestionV3.find({
            answerMachineRequestV3Id,
            status: 'answered',
        }).sort({ answerMachineIteration: 1, stepIndex: 1, createdAtUtc: 1 });

        const subQuestionsContext = subQuestions
            .map(
                (sq) =>
                    `Outer iter ${sq.answerMachineIteration} · step ${sq.stepIndex ?? 0} [${sq.kind}]: ${sq.question || 'N/A'}\nA: ${sq.answer || 'N/A'}\nVerify: ${sq.verificationVerdict || 'n/a'}`
            )
            .join('\n\n');

        const answerMachineRecord = await ModelAnswerMachineRequestV3.findById(answerMachineRequestV3Id);
        const intermediateAnswers = answerMachineRecord?.intermediateAnswers ?? [];

        const intermediateAnswersContext = intermediateAnswers
            .filter((answer) => answer && typeof answer === 'string' && answer.trim())
            .map((answer, index) => `Intermediate ${index + 1}:\n${answer.trim()}`)
            .join('\n\n');

        let evaluationPrompt = `You evaluate Answer Machine 3 output against one GLOBAL TASK.\n`;
        if (globalTaskDescription.trim()) {
            evaluationPrompt += `\nGLOBAL TASK:\n${globalTaskDescription.trim()}`;
        }

        if (conversationContext) evaluationPrompt += `\n\nCONVERSATION CONTEXT:\n${conversationContext}`;
        if (subQuestionsContext) evaluationPrompt += `\n\nSEQUENTIAL REASONING STEPS:\n${subQuestionsContext}`;
        if (intermediateAnswersContext) {
            evaluationPrompt += `\n\nINTERMEDIATE ANSWERS:\n${intermediateAnswersContext}`;
        }

        evaluationPrompt += `\n\nAnswer to evaluate:\n${finalAnswer}\n\nRespond JSON:\n` +
            `{"isSatisfactory":boolean,"confidence":number,"reason":"string max 200 chars",` +
            `"globalTaskAssessment":{"allImpliedSubtasksDone":boolean,"finalAnswerDeliverable":boolean,"globalTaskChecklist":"string"}}\n` +
            `- isSatisfactory: whether the answer adequately fulfills the GLOBAL TASK.\n` +
            `- globalTaskChecklist: implied subtasks from the GLOBAL TASK and whether each is satisfied by this final answer.\n` +
            `- allImpliedSubtasksDone / finalAnswerDeliverable should align with isSatisfactory.`;

        const messages: Message[] = [
            {
                role: 'system',
                content: 'You are an expert evaluator. Respond with valid JSON only.',
            },
            { role: 'user', content: evaluationPrompt },
        ];

        const llmResult = await fetchLlmUnified({
            provider: llmConfig.provider,
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: llmConfig.model,
            messages,
            temperature: 0.1,
            maxTokens: 1024,
            responseFormat: 'json_object',
            headersExtra: llmConfig.customHeaders,
            abortSignal,
        });

        if (!llmResult.success || !llmResult.content) {
            if (abortSignal?.aborted) {
                return {
                    isSatisfactory: false,
                    reason: 'Cancelled',
                    confidence: 0,
                    allImpliedSubtasksDone: false,
                    finalAnswerDeliverable: false,
                    globalTaskChecklist: '',
                    cancelled: true,
                };
            }
            return {
                isSatisfactory: false,
                reason: 'LLM evaluation failed',
                confidence: 0,
                allImpliedSubtasksDone: false,
                finalAnswerDeliverable: false,
                globalTaskChecklist: '',
            };
        }

        try {
            await trackAnswerMachineTokens(threadId, llmResult.usageStats, username, 'evaluation');
        } catch {
            /* empty */
        }

        try {
            const parsed = JSON.parse(llmResult.content) as {
                isSatisfactory?: boolean;
                confidence?: number;
                reason?: string;
                globalTaskAssessment?: {
                    allImpliedSubtasksDone?: boolean;
                    finalAnswerDeliverable?: boolean;
                    globalTaskChecklist?: string;
                };
            };

            const ga = parsed.globalTaskAssessment;
            const allImpliedSubtasksDone = ga?.allImpliedSubtasksDone === true;
            const finalAnswerDeliverable = ga?.finalAnswerDeliverable === true;
            const globalTaskChecklist =
                typeof ga?.globalTaskChecklist === 'string' ? ga.globalTaskChecklist.trim().slice(0, 2000) : '';

            if (
                typeof parsed.isSatisfactory === 'boolean' &&
                typeof parsed.confidence === 'number' &&
                typeof parsed.reason === 'string'
            ) {
                return {
                    isSatisfactory: parsed.isSatisfactory,
                    confidence: Math.max(0, Math.min(1, parsed.confidence)),
                    reason: parsed.reason.substring(0, 200),
                    allImpliedSubtasksDone,
                    finalAnswerDeliverable,
                    globalTaskChecklist,
                };
            }
            return {
                isSatisfactory: false,
                reason: 'Invalid evaluator JSON shape',
                confidence: 0,
                allImpliedSubtasksDone: false,
                finalAnswerDeliverable: false,
                globalTaskChecklist: '',
            };
        } catch {
            return {
                isSatisfactory: false,
                reason: 'Failed to parse evaluator JSON',
                confidence: 0,
                allImpliedSubtasksDone: false,
                finalAnswerDeliverable: false,
                globalTaskChecklist: '',
            };
        }
    } catch (error) {
        console.error('[AM3 Evaluation]', error);
        return {
            isSatisfactory: false,
            reason: 'Evaluation error',
            confidence: 0,
            allImpliedSubtasksDone: false,
            finalAnswerDeliverable: false,
            globalTaskChecklist: '',
        };
    }
};

const step5EvaluateAnswer = async ({
    answerMachineRequestV3Id,
    abortSignal,
}: {
    answerMachineRequestV3Id: mongoose.Types.ObjectId;
    abortSignal?: AbortSignal;
}): Promise<{ success: boolean; errorReason: string; data: null }> => {
    try {
        const answerMachineRecord = await ModelAnswerMachineRequestV3.findById(answerMachineRequestV3Id);
        if (!answerMachineRecord) {
            return { success: false, errorReason: 'Answer Machine V3 request not found', data: null };
        }

        const llmConfig = await getLlmConfig({ threadId: answerMachineRecord.threadId });
        if (!llmConfig) {
            return { success: false, errorReason: 'Failed to get LLM configuration', data: null };
        }

        const finalAnswer = answerMachineRecord.finalAnswer || '';

        const parentMsg = await ModelChatLlm.findById(answerMachineRecord.parentMessageId);
        const goalFromParent =
            parentMsg?.type === 'text' && typeof parentMsg.content === 'string' ? parentMsg.content.trim() : '';
        const globalTaskDescription =
            (answerMachineRecord.globalTaskDescription || '').trim() || goalFromParent;

        const evaluation = await evaluateFinalAnswer(
            finalAnswer,
            llmConfig,
            answerMachineRecord.threadId,
            answerMachineRecord.username,
            answerMachineRequestV3Id,
            globalTaskDescription,
            abortSignal
        );

        if (evaluation.cancelled) {
            return { success: false, errorReason: 'Cancelled', data: null };
        }

        const currentIntermediateAnswers = answerMachineRecord.intermediateAnswers || [];
        const updatedIntermediateAnswers = [...currentIntermediateAnswers, finalAnswer];

        let insertedChatMessageId: mongoose.Types.ObjectId | null = null;

        if (
            evaluation.isSatisfactory &&
            answerMachineRecord.currentIteration >= answerMachineRecord.minNumberOfIterations
        ) {
            insertedChatMessageId = await createFinalAnswerMessageWithTokens(
                finalAnswer,
                answerMachineRecord.threadId,
                answerMachineRecord.username,
                llmConfig
            );

            await ModelAnswerMachineRequestV3.findByIdAndUpdate(answerMachineRequestV3Id, {
                $set: {
                    status: 'answered',
                    finalAnswer,
                    intermediateAnswers: updatedIntermediateAnswers,
                    isSatisfactoryFinalAnswer: true,
                    updatedAt: new Date(),
                },
            });
        } else {
            await ModelAnswerMachineRequestV3.findByIdAndUpdate(answerMachineRequestV3Id, {
                $set: {
                    intermediateAnswers: updatedIntermediateAnswers,
                    isSatisfactoryFinalAnswer: evaluation.isSatisfactory,
                    updatedAt: new Date(),
                },
            });
        }

        await ModelAnswerMachineEvaluateAnswerV3.create({
            answerMachineRequestV3Id,
            threadId: answerMachineRecord.threadId,
            username: answerMachineRecord.username,
            isSatisfactory: evaluation.isSatisfactory,
            confidence: evaluation.confidence,
            evaluationReason: evaluation.reason,
            evaluationAllImpliedSubtasksDone: evaluation.allImpliedSubtasksDone,
            evaluationFinalAnswerDeliverable: evaluation.finalAnswerDeliverable,
            evaluationGlobalTaskChecklist: evaluation.globalTaskChecklist,
            insertedChatMessageId,
            promptTokens: 0,
            completionTokens: 0,
            reasoningTokens: 0,
            totalTokens: 0,
            costInUsd: 0,
        });

        return { success: true, errorReason: '', data: null };
    } catch (error) {
        console.error(`❌ AM3 step5 (request ${answerMachineRequestV3Id}):`, error);
        return {
            success: false,
            errorReason: error instanceof Error ? error.message : 'Internal server error',
            data: null,
        };
    }
};

export default step5EvaluateAnswer;
