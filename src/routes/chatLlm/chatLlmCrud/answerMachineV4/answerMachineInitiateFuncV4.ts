import mongoose from 'mongoose';

import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelChatLlmThread } from '../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelAnswerMachineRequestV4 } from '../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineRequestV4.schema';
import { ModelAnswerMachineFileV4 } from '../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineFileV4.schema';

import executeIterationV4 from './executeIterationV4';

const answerMachineInitiateFuncV4 = async ({
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

        if (thread.answerEngine !== 'answerMachine4') {
            return { success: false, errorReason: 'Thread is not configured for Answer Machine 4', data: null };
        }

        const globalTaskDescription =
            message.type === 'text' && typeof message.content === 'string' ? message.content.trim() : '';

        const answerMachineRecord = await ModelAnswerMachineRequestV4.create({
            threadId: message.threadId,
            parentMessageId: messageId,
            username: thread.username,
            schemaVersion: 4,
            status: 'pending',
            errorReason: '',
            minNumberOfIterations: thread.answerMachineMinNumberOfIterations,
            maxNumberOfIterations: Math.min(thread.answerMachineMaxNumberOfIterations, 100),
            currentIteration: 1,
            intermediateAnswers: [],
            finalAnswer: '',
            isSatisfactoryFinalAnswer: false,
            globalTaskDescription,
            attachedFiles: [],
            opencodeSessionId: '',
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalReasoningTokens: 0,
            totalTokens: 0,
            costInUsd: 0,
        });

        const msgUtc = message.createdAtUtc ? new Date(message.createdAtUtc) : new Date();
        const winStart = new Date(msgUtc.getTime() - 60 * 60 * 1000);
        const winEnd = new Date(msgUtc.getTime() + 3 * 60 * 1000);
        const orphanUploads = await ModelAnswerMachineFileV4.find({
            threadId: message.threadId,
            username: thread.username,
            fileRole: 'user_attachment',
            uploadStatus: 'saved_to_shell',
            $or: [{ answerMachineRequestV4Id: null }, { answerMachineRequestV4Id: { $exists: false } }],
            createdAtUtc: { $gte: winStart, $lte: winEnd },
        })
            .select('_id')
            .lean();
        if (orphanUploads.length > 0) {
            const oids = orphanUploads.map((o) => o._id);
            await ModelAnswerMachineFileV4.updateMany(
                { _id: { $in: oids } },
                { $set: { answerMachineRequestV4Id: answerMachineRecord._id } }
            );
            await ModelAnswerMachineRequestV4.findByIdAndUpdate(answerMachineRecord._id, {
                $addToSet: { attachedFiles: { $each: oids } },
                $set: { updatedAt: new Date() },
            });
        }

        for (let i = 1; i <= answerMachineRecord.maxNumberOfIterations; i++) {
            if (abortSignal?.aborted) {
                await ModelAnswerMachineRequestV4.findByIdAndUpdate(answerMachineRecord._id, {
                    $set: { status: 'error', errorReason: 'Cancelled by user', updatedAt: new Date() },
                });
                return { success: true, errorReason: '', data: null };
            }

            const iterationResult = await executeIterationV4({
                answerMachineRequestV4Id: answerMachineRecord._id,
                abortSignal,
            });

            if (iterationResult.errorReason === 'Cancelled' || abortSignal?.aborted) {
                await ModelAnswerMachineRequestV4.findByIdAndUpdate(answerMachineRecord._id, {
                    $set: { status: 'error', errorReason: 'Cancelled by user', updatedAt: new Date() },
                });
                return { success: true, errorReason: '', data: null };
            }

            if (!iterationResult.success) {
                await ModelAnswerMachineRequestV4.findByIdAndUpdate(answerMachineRecord._id, {
                    $set: {
                        status: 'error',
                        errorReason: iterationResult.errorReason || 'Iteration failed',
                        updatedAt: new Date(),
                    },
                });
                return { success: false, errorReason: iterationResult.errorReason || 'Iteration failed', data: null };
            }

            const refreshed = await ModelAnswerMachineRequestV4.findById(answerMachineRecord._id);
            if (refreshed?.status === 'answered') {
                break;
            }

            await ModelAnswerMachineRequestV4.findByIdAndUpdate(answerMachineRecord._id, {
                $set: {
                    currentIteration: i + 1,
                    updatedAt: new Date(),
                },
            });
        }

        const finalRow = await ModelAnswerMachineRequestV4.findById(answerMachineRecord._id);
        if (finalRow?.status === 'answered') {
            return { success: true, errorReason: '', data: null };
        }

        return { success: true, errorReason: '', data: null };
    } catch (error) {
        console.error(`❌ answerMachineInitiateFuncV4 (${messageId}):`, error);
        return {
            success: false,
            errorReason: error instanceof Error ? error.message : 'Internal server error',
            data: null,
        };
    }
};

export default answerMachineInitiateFuncV4;
