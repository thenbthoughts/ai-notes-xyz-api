import mongoose from 'mongoose';

import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelChatLlmThread } from '../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelAnswerMachineRequestV3 } from '../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineRequestV3.schema';
import { recordAnswerMachineFileArtifact } from '../answerMachineFileService';

import executeIteration from './executeIteration';

const answerMachineInitiateFuncV3 = async ({
    messageId,
    abortSignal,
}: {
    messageId: mongoose.Types.ObjectId;
    abortSignal?: AbortSignal;
}): Promise<{
    success: boolean;
    errorReason: string;
    data: null;
}> => {
    try {
        const message = await ModelChatLlm.findById(messageId);
        if (!message) {
            return { success: false, errorReason: 'Message not found', data: null };
        }

        const thread = await ModelChatLlmThread.findById(message.threadId);
        if (!thread) {
            return { success: false, errorReason: 'Thread not found', data: null };
        }

        const globalTaskDescription =
            message.type === 'text' && typeof message.content === 'string' ? message.content.trim() : '';

        const answerMachineRecord = await ModelAnswerMachineRequestV3.create({
            threadId: message.threadId,
            parentMessageId: messageId,
            username: thread.username,
            schemaVersion: 3,
            status: 'pending',
            errorReason: '',
            usedOpencode: thread.answerMachineUsedOpencode,
            usedWebSearch: thread.answerMachineUsedWebSearch,
            minNumberOfIterations: thread.answerMachineMinNumberOfIterations,
            maxNumberOfIterations: Math.min(thread.answerMachineMaxNumberOfIterations, 100),
            currentIteration: 1,
            intermediateAnswers: [],
            finalAnswer: '',
            isSatisfactoryFinalAnswer: false,
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalReasoningTokens: 0,
            totalTokens: 0,
            costInUsd: 0,
            globalTaskDescription,
        });

        const uploadableMessageTypes = new Set(['document', 'file', 'image', 'video', 'audio']);
        const triggerFileUrl = typeof message.fileUrl === 'string' ? message.fileUrl.trim() : '';
        const triggerType = typeof message.type === 'string' ? message.type : '';
        if (triggerFileUrl && uploadableMessageTypes.has(triggerType)) {
            const registered = await recordAnswerMachineFileArtifact({
                username: thread.username,
                threadId: thread._id,
                answerMachineRequestV3Id: answerMachineRecord._id,
                answerMachineIteration: null,
                answerMachineSubQuestionV3Id: null,
                fileType: 'user_upload',
                purpose: 'user_attachment',
                storedFileUrl: triggerFileUrl,
                originalName: triggerFileUrl.split('/').pop() || 'attachment',
                mimeType: 'application/octet-stream',
                description: 'User attachment on the chat message that started this Answer Machine V3 request',
            });
            if (!registered.ok) {
                console.warn('[answerMachineInitiateFuncV3] Could not register trigger attachment:', registered.error);
            }
        }

        for (let i = 1; i <= answerMachineRecord.maxNumberOfIterations; i++) {
            if (abortSignal?.aborted) {
                await ModelAnswerMachineRequestV3.findByIdAndUpdate(answerMachineRecord._id, {
                    $set: { status: 'error', errorReason: 'Cancelled by user', updatedAt: new Date() },
                });
                return { success: true, errorReason: '', data: null };
            }

            const iterationResult = await executeIteration({
                answerMachineRequestV3Id: answerMachineRecord._id,
                abortSignal,
            });

            if (iterationResult.errorReason === 'Cancelled' || abortSignal?.aborted) {
                await ModelAnswerMachineRequestV3.findByIdAndUpdate(answerMachineRecord._id, {
                    $set: { status: 'error', errorReason: 'Cancelled by user', updatedAt: new Date() },
                });
                return { success: true, errorReason: '', data: null };
            }

            if (!iterationResult.success) {
                await ModelAnswerMachineRequestV3.findByIdAndUpdate(answerMachineRecord._id, {
                    $set: {
                        status: 'error',
                        errorReason: iterationResult.errorReason || 'Iteration failed',
                        updatedAt: new Date(),
                    },
                });
                return { success: false, errorReason: iterationResult.errorReason || 'Iteration failed', data: null };
            }

            const refreshed = await ModelAnswerMachineRequestV3.findById(answerMachineRecord._id);
            if (refreshed?.status === 'answered') {
                break;
            }

            await ModelAnswerMachineRequestV3.findByIdAndUpdate(answerMachineRecord._id, {
                $set: {
                    currentIteration: i + 1,
                    updatedAt: new Date(),
                },
            });
        }

        const finalRow = await ModelAnswerMachineRequestV3.findById(answerMachineRecord._id);
        if (finalRow?.status === 'answered') {
            return { success: true, errorReason: '', data: null };
        }

        return { success: true, errorReason: '', data: null };
    } catch (error) {
        console.error(`❌ answerMachineInitiateFuncV3 (${messageId}):`, error);
        return {
            success: false,
            errorReason: error instanceof Error ? error.message : 'Internal server error',
            data: null,
        };
    }
};

export default answerMachineInitiateFuncV3;
