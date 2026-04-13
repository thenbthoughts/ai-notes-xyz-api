import mongoose from "mongoose";

import { ModelChatLlm } from "../../../../schema/schemaChatLlm/SchemaChatLlm.schema";

import { ModelChatLlmThread } from "../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema";
import { ModelChatLlmAnswerMachine } from "../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaChatLlmAnswerMachine.schema";

import executeIteration from "./executeIteration";

// -----

const answerMachineInitiateFunc = async ({
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
            return {
                success: false,
                errorReason: 'Message not found',
                data: null,
            };
        }

        console.log('message', message);
        console.log('messageId', messageId);
        console.log('message.threadId', message.threadId);

        const thread = await ModelChatLlmThread.findById(message.threadId);
        if (!thread) {
            return {
                success: false,
                errorReason: 'Thread not found',
                data: null,
            };
        }

        const answerMachineRecord = await ModelChatLlmAnswerMachine.create({
            threadId: message.threadId,
            parentMessageId: messageId,
            username: thread.username,
            status: 'pending',
            errorReason: '',
            usedOpencode: thread.answerMachineUsedOpencode,
            usedWebSearch: thread.answerMachineUsedWebSearch,
            minNumberOfIterations: thread.answerMachineMinNumberOfIterations,
            maxNumberOfIterations: Math.min(thread.answerMachineMaxNumberOfIterations, 100),
            currentIteration: 1,
            intermediateAnswers: [],
            finalAnswer: '',
        });

        for (let i = 1; i <= answerMachineRecord.maxNumberOfIterations; i++) {
            if (abortSignal?.aborted) {
                await ModelChatLlmAnswerMachine.findByIdAndUpdate(answerMachineRecord._id, {
                    $set: { status: 'error', errorReason: 'Cancelled by user' },
                });
                return {
                    success: true,
                    errorReason: '',
                    data: null,
                };
            }

            console.log(`----- executeIteration: ${i},  of ${answerMachineRecord.maxNumberOfIterations} -----`);
            const iterationResult = await executeIteration({
                answerMachineRecordId: answerMachineRecord._id,
                abortSignal,
            });

            if (iterationResult.errorReason === 'Cancelled' || abortSignal?.aborted) {
                await ModelChatLlmAnswerMachine.findByIdAndUpdate(answerMachineRecord._id, {
                    $set: { status: 'error', errorReason: 'Cancelled by user' },
                });
                return {
                    success: true,
                    errorReason: '',
                    data: null,
                };
            }

            // get the answer machine record
            const answerMachineRecordValidate = await ModelChatLlmAnswerMachine.findOne({ _id: answerMachineRecord._id });
            if (answerMachineRecordValidate) {

                if (answerMachineRecordValidate.status === 'answered') {
                    break;
                }

                // go for next iteration and update the answer machine record
                await ModelChatLlmAnswerMachine.findByIdAndUpdate(answerMachineRecord._id, {
                    $set: {
                        currentIteration: i + 1,
                    },
                });
            }
        }

        // get the final answer from the answer machine record
        const finalAnswer = await ModelChatLlmAnswerMachine.findOne({ _id: answerMachineRecord._id });
        if (finalAnswer) {
            if (finalAnswer?.status === 'answered') {
                return {
                    success: true,
                    errorReason: '',
                    data: null,
                };
            }
        }

        // answer machine has finished unsuccessfully
        return {
            success: true,
            errorReason: '',
            data: null,
        };
    } catch (error) {
        console.error(`❌ Error in answerMachineInitiate (message ${messageId}):`, error);
        const errorMessage = error instanceof Error ? error.message : 'Internal server error';
        return {
            success: false,
            errorReason: errorMessage,
            data: null,
        };
    }
}

export default answerMachineInitiateFunc;