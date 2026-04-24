import mongoose from 'mongoose';

import { ModelChatLlmOpencodeTask } from '../../../schema/schemaChatLlm/SchemaChatLlmOpencodeTask.schema';
import type { tsUserApiKey } from '../../../utils/llm/llmCommonFunc';

import { getOrCreateThreadOpencodeSession } from './opencodeSessionService';
import { planOpencodeTasksWithLlm, type OpencodePlannedTask } from './opencodeTaskPlanner';
import { executeOpencodeTaskList } from './opencodeTaskRunner';

/** Insert OpenCode task rows and execute (used when the caller already has a plan, e.g. concise pipeline). */
export async function runOpencodeTasksFromPlannedList({
    username,
    threadId,
    userApiKey,
    triggerMessageId,
    answerMachineRecordId,
    tasks,
}: {
    username: string;
    threadId: mongoose.Types.ObjectId;
    userApiKey: tsUserApiKey;
    triggerMessageId?: mongoose.Types.ObjectId;
    answerMachineRecordId?: mongoose.Types.ObjectId;
    tasks: OpencodePlannedTask[];
}): Promise<{
    plannedCount: number;
    executedCount: number;
    taskIds: mongoose.Types.ObjectId[];
    summaryText: string;
    errorReason: string;
    outputFileRefs: Array<{ fileName: string; filePath: string; contentType: string; size: number }>;
}> {
    const sessionRes = await getOrCreateThreadOpencodeSession({
        username,
        threadId,
        userApiKey,
    });
    if (sessionRes.errorReason) {
        return {
            plannedCount: 0,
            executedCount: 0,
            taskIds: [],
            summaryText: '',
            errorReason: sessionRes.errorReason,
            outputFileRefs: [],
        };
    }

    if (tasks.length === 0) {
        return {
            plannedCount: 0,
            executedCount: 0,
            taskIds: [],
            summaryText: '',
            errorReason: '',
            outputFileRefs: [],
        };
    }

    const now = new Date();
    const inserts = await ModelChatLlmOpencodeTask.insertMany(
        tasks.map((t, idx) => ({
            threadId,
            username,
            triggerMessageId: triggerMessageId || null,
            answerMachineRecordId: answerMachineRecordId || null,
            sortIndex: idx,
            title: t.title,
            instruction: t.instruction,
            status: 'pending',
            summary: '',
            errorReason: '',
            inputFileRefs: [],
            outputFileRefs: [],
            createdAtUtc: now,
            updatedAtUtc: now,
        }))
    );
    const taskIds = inserts.map((doc) => doc._id as mongoose.Types.ObjectId);

    try {
        const execRes = await executeOpencodeTaskList({
            username,
            threadId,
            userApiKey,
            client: sessionRes.client,
            workspaceDirectory: sessionRes.workspaceDirectory,
            sdkSessionId: sessionRes.sdkSessionId,
            taskIds,
        });
        return {
            plannedCount: tasks.length,
            executedCount: taskIds.length,
            taskIds,
            summaryText: execRes.summaryText,
            errorReason: execRes.errorReason,
            outputFileRefs: Array.isArray(execRes.outputFileRefs) ? execRes.outputFileRefs : [],
        };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const errNow = new Date();
        await ModelChatLlmOpencodeTask.updateMany(
            {
                _id: { $in: taskIds },
                status: 'pending',
            },
            {
                $set: {
                    status: 'error',
                    errorReason: `OpenCode run aborted before this task could start: ${msg.slice(0, 600)}`,
                    updatedAtUtc: errNow,
                },
            }
        );
        return {
            plannedCount: tasks.length,
            executedCount: 0,
            taskIds,
            summaryText: '',
            errorReason: msg,
            outputFileRefs: [],
        };
    }
}

export async function runOpencodeTasksForChatTurn({
    username,
    threadId,
    userApiKey,
    triggerMessageId,
    answerMachineRecordId,
    llmPlannerConfig,
    userPrompt,
    systemPromptPrefix,
}: {
    username: string;
    threadId: mongoose.Types.ObjectId;
    userApiKey: tsUserApiKey;
    triggerMessageId?: mongoose.Types.ObjectId;
    answerMachineRecordId?: mongoose.Types.ObjectId;
    llmPlannerConfig: {
        provider: 'openrouter' | 'groq' | 'ollama' | 'localai' | 'openai-compatible';
        apiKey: string;
        apiEndpoint: string;
        model: string;
    };
    userPrompt: string;
    systemPromptPrefix: string;
}): Promise<{
    plannedCount: number;
    executedCount: number;
    taskIds: mongoose.Types.ObjectId[];
    summaryText: string;
    errorReason: string;
    outputFileRefs: Array<{ fileName: string; filePath: string; contentType: string; size: number }>;
}> {
    const sessionRes = await getOrCreateThreadOpencodeSession({
        username,
        threadId,
        userApiKey,
    });
    if (sessionRes.errorReason) {
        return {
            plannedCount: 0,
            executedCount: 0,
            taskIds: [],
            summaryText: '',
            errorReason: sessionRes.errorReason,
            outputFileRefs: [],
        };
    }

    const planRes = await planOpencodeTasksWithLlm({
        provider: llmPlannerConfig.provider,
        apiKey: llmPlannerConfig.apiKey,
        apiEndpoint: llmPlannerConfig.apiEndpoint,
        model: llmPlannerConfig.model,
        systemPromptPrefix,
        userPrompt,
        openCodeWorkspaceDirectory: sessionRes.workspaceDirectory,
    });
    if (planRes.errorReason) {
        return {
            plannedCount: 0,
            executedCount: 0,
            taskIds: [],
            summaryText: '',
            errorReason: planRes.errorReason,
            outputFileRefs: [],
        };
    }

    const tasks = planRes.tasks;
    if (tasks.length === 0) {
        return {
            plannedCount: 0,
            executedCount: 0,
            taskIds: [],
            summaryText: '',
            errorReason: '',
            outputFileRefs: [],
        };
    }

    const now = new Date();
    const inserts = await ModelChatLlmOpencodeTask.insertMany(
        tasks.map((t, idx) => ({
            threadId,
            username,
            triggerMessageId: triggerMessageId || null,
            answerMachineRecordId: answerMachineRecordId || null,
            sortIndex: idx,
            title: t.title,
            instruction: t.instruction,
            status: 'pending',
            summary: '',
            errorReason: '',
            inputFileRefs: [],
            outputFileRefs: [],
            createdAtUtc: now,
            updatedAtUtc: now,
        }))
    );
    const taskIds = inserts.map((doc) => doc._id as mongoose.Types.ObjectId);

    let execRes: {
        summaryText: string;
        errorReason: string;
        outputFileRefs: Array<{ fileName: string; filePath: string; contentType: string; size: number }>;
    };
    try {
        execRes = await executeOpencodeTaskList({
            username,
            threadId,
            userApiKey,
            client: sessionRes.client,
            workspaceDirectory: sessionRes.workspaceDirectory,
            sdkSessionId: sessionRes.sdkSessionId,
            taskIds,
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const now = new Date();
        await ModelChatLlmOpencodeTask.updateMany(
            {
                _id: { $in: taskIds },
                status: 'pending',
            },
            {
                $set: {
                    status: 'error',
                    errorReason: `OpenCode run aborted before this task could start: ${msg.slice(0, 600)}`,
                    updatedAtUtc: now,
                },
            }
        );
        return {
            plannedCount: tasks.length,
            executedCount: 0,
            taskIds,
            summaryText: '',
            errorReason: msg,
            outputFileRefs: [],
        };
    }

    return {
        plannedCount: tasks.length,
        executedCount: taskIds.length,
        taskIds,
        summaryText: execRes.summaryText,
        errorReason: execRes.errorReason,
        outputFileRefs: Array.isArray(execRes.outputFileRefs) ? execRes.outputFileRefs : [],
    };
}

