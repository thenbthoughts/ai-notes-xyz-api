import mongoose from 'mongoose';

import { ModelAnswerMachineRequestV4 } from '../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineRequestV4.schema';
import { ModelAnswerMachineSubQuestionV4 } from '../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineSubQuestionV4.schema';
import { ModelAnswerMachineFileV4 } from '../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineFileV4.schema';
import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelChatLlmThread } from '../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelUserApiKey } from '../../../../schema/schemaUser/SchemaUserApiKey.schema';
import { IChatLlm } from '../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types';
import { AnswerMachineVerificationVerdictV4 } from '../../../../types/typesSchema/typesChatLlm/typesAnswerMachine/SchemaAnswerMachineSubQuestionV4.types';
import fetchLlmUnified from '../../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { getApiKeyByObject } from '../../../../utils/llm/llmCommonFunc';
import { validateOpencodeHealth } from '../../../../utils/opencode/validateOpencodeHealth';
import tryFinalizeAnswerMachineV4Cancellation from './tryFinalizeAnswerMachineV4Cancellation';
import { getLlmConfig } from '../answerMachineShared/answerMachineGetLlmConfig';
import { trackAnswerMachineTokens } from '../answerMachineShared/tokenTracking';
import { AM4_OPENCODE_DEFAULT_EXECUTOR_MODEL, AM4_OPENCODE_EXECUTOR_SYSTEM } from './am4OpencodeConstants';
import { getAm4OpencodeConfig, getAm4ShellUploadConfig } from './am4ShellAndOpencodeConfig';
import { createAm4OpencodeClient, runAm4SessionPromptAndCollectAssistant, syncAm4OpencodeProviderCredentials } from './am4OpencodeClient';
import {
    ensureAm4ShellWorkDirectoryMarker,
    syncAm4RequestAttachmentsIntoCanonicalShellLayout,
    syncAm4AssistantOutputFilesFromShellToUserStorage,
} from './am4FileTransferTools';
import { opencodeModelFromLlmConfig } from './mapLlmConfigToOpencodeModel';

const MAX_VERIFY_RETRIES_PER_STEP = 3;

function parseVerifierGlobalAssessment(raw: unknown): {
    allImpliedSubtasksDone: boolean;
    finalAnswerDeliverable: boolean;
    globalTaskChecklist: string;
} {
    const empty = { allImpliedSubtasksDone: false, finalAnswerDeliverable: false, globalTaskChecklist: '' };
    if (!raw || typeof raw !== 'object') return empty;
    const o = raw as Record<string, unknown>;
    const nested = o.globalTaskAssessment;
    const src =
        nested && typeof nested === 'object' && !Array.isArray(nested)
            ? (nested as Record<string, unknown>)
            : o;
    const checklistRaw =
        typeof src.globalTaskChecklist === 'string'
            ? src.globalTaskChecklist
            : typeof o.globalTaskChecklist === 'string'
              ? o.globalTaskChecklist
              : '';
    return {
        allImpliedSubtasksDone: src.allImpliedSubtasksDone === true,
        finalAnswerDeliverable: src.finalAnswerDeliverable === true,
        globalTaskChecklist: checklistRaw.trim().slice(0, 2000),
    };
}

function formatPriorSteps(
    rows: Array<{
        answerMachineIteration?: number;
        stepIndex?: number;
        attemptNumber?: number;
        kind?: string;
        question?: string;
        answer?: string;
        verificationVerdict?: string;
        verificationReason?: string;
    }>
): string {
    return rows
        .map((s) => {
            const outerIter = s.answerMachineIteration ?? '?';
            const si = s.stepIndex ?? 0;
            const att = s.attemptNumber ?? 1;
            return `Outer iteration ${outerIter} · step ${si} (attempt ${att}) [${s.kind || 'unknown'}]\nQ: ${s.question || ''}\nA: ${(s.answer || '').slice(0, 8000)}\nVerify: ${s.verificationVerdict || 'n/a'} — ${(s.verificationReason || '').slice(0, 400)}`;
        })
        .join('\n\n');
}

function normalizePlannedAm4(raw: unknown): { readyToSynthesize: boolean; workingQuestion: string } | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const readyToSynthesize = o.readyToSynthesize === true;
    const workingQuestion = typeof o.workingQuestion === 'string' ? o.workingQuestion.trim() : '';
    if (readyToSynthesize) {
        return { readyToSynthesize: true, workingQuestion: '' };
    }
    if (!workingQuestion) return null;

    return { readyToSynthesize: false, workingQuestion };
}

async function planNextAm4Step(params: {
    threadId: mongoose.Types.ObjectId;
    username: string;
    globalTask: string;
    conversationText: string;
    intermediateAnswersText: string;
    priorAnsweredStepsText: string;
    attachedFilesSummary: string;
    currentIteration: number;
    llmConfig: NonNullable<Awaited<ReturnType<typeof getLlmConfig>>>;
    abortSignal?: AbortSignal;
}): Promise<
    | { ok: true; data: { readyToSynthesize: boolean; workingQuestion: string } }
    | { ok: false; cancelled: boolean; errorReason: string }
> {
    const {
        threadId,
        username,
        globalTask,
        conversationText,
        intermediateAnswersText,
        priorAnsweredStepsText,
        attachedFilesSummary,
        currentIteration,
        llmConfig,
        abortSignal,
    } = params;

    let sys = `You plan the next single step for Answer Machine 4 (Opencode-only agent).\n`;
    sys += `Reply JSON only: {"readyToSynthesize":boolean,"workingQuestion":string}\n`;
    sys += `- If the GLOBAL TASK is fully satisfied by prior work, set readyToSynthesize true and workingQuestion "".\n`;
    sys += `- Otherwise set readyToSynthesize false and ONE focused workingQuestion. The executor will run it in OpenCode using local workspace file paths (no external shell upload service).\n`;
    sys += `The executor runs in an Ubuntu 24 Docker container: it may install missing tools via apt (non-interactive) when that advances the task.\n`;
    if (currentIteration > 1) {
        sys += `This is outer iteration ${currentIteration}; consider prior drafts and steps.\n`;
    }

    const userParts: string[] = [];
    userParts.push(`GLOBAL TASK:\n${globalTask}`);
    if (conversationText) userParts.push(`CONVERSATION:\n${conversationText}`);
    if (attachedFilesSummary) userParts.push(`ATTACHED FILES:\n${attachedFilesSummary}`);
    if (intermediateAnswersText) userParts.push(`PRIOR OUTER ITERATION DRAFTS:\n${intermediateAnswersText}`);
    if (priorAnsweredStepsText) userParts.push(`COMPLETED STEPS FROM PRIOR OUTER ITERATIONS:\n${priorAnsweredStepsText}`);
    userParts.push(
        `Plan for **outer iteration ${currentIteration} only**: at most one workingQuestion (or readyToSynthesize).`
    );

    const llmResult = await fetchLlmUnified({
        provider: llmConfig.provider,
        apiKey: llmConfig.apiKey,
        apiEndpoint: llmConfig.apiEndpoint,
        model: llmConfig.model,
        messages: [
            { role: 'system', content: sys },
            { role: 'user', content: userParts.join('\n\n') },
        ],
        temperature: 0.25,
        maxTokens: 2048,
        responseFormat: 'json_object',
        headersExtra: llmConfig.customHeaders,
        abortSignal,
    });

    if (!llmResult.success || !llmResult.content) {
        if (abortSignal?.aborted) {
            return { ok: false, cancelled: true, errorReason: 'Cancelled' };
        }
        return { ok: false, cancelled: false, errorReason: llmResult.error || 'Planner LLM failed' };
    }

    try {
        await trackAnswerMachineTokens(threadId, llmResult.usageStats, username, 'question_generation');
    } catch {
        /* empty */
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(llmResult.content);
    } catch {
        return { ok: false, cancelled: false, errorReason: 'Invalid planner JSON' };
    }

    const norm = normalizePlannedAm4(parsed);
    if (!norm) {
        return { ok: false, cancelled: false, errorReason: 'Planner returned unusable data' };
    }
    return { ok: true, data: norm };
}

async function verifySequentialStepAm4(params: {
    threadId: mongoose.Types.ObjectId;
    username: string;
    globalTaskDescription: string;
    cumulativePriorStepsText: string;
    maxOuterIterations: number;
    currentOuterIteration: number;
    workingQuestion: string;
    answer: string;
    llmConfig: NonNullable<Awaited<ReturnType<typeof getLlmConfig>>>;
    abortSignal?: AbortSignal;
}): Promise<
    | {
          ok: true;
          verdict: AnswerMachineVerificationVerdictV4;
          reason: string;
          retryHint: string;
          allImpliedSubtasksDone: boolean;
          finalAnswerDeliverable: boolean;
          globalTaskChecklist: string;
      }
    | { ok: false; cancelled: boolean; errorReason: string }
> {
    const {
        threadId,
        username,
        globalTaskDescription,
        cumulativePriorStepsText,
        maxOuterIterations,
        currentOuterIteration,
        workingQuestion,
        answer,
        llmConfig,
        abortSignal,
    } = params;

    const outerRemaining = Math.max(0, maxOuterIterations - currentOuterIteration);

    const userParts: string[] = [];
    userParts.push(
        `GLOBAL TASK (single objective for the entire run — may imply several sub-requirements):\n${globalTaskDescription}`
    );
    if (cumulativePriorStepsText.trim()) {
        userParts.push(`COMPLETED STEPS FROM PRIOR OUTER ITERATIONS:\n${cumulativePriorStepsText}`);
    }
    userParts.push(
        `OUTER PASS BUDGET: this is outer iteration ${currentOuterIteration} of ${maxOuterIterations}. After this pass completes, at most ${outerRemaining} further outer iteration(s) may run.`
    );
    userParts.push(`THIS STEP QUESTION:\n${workingQuestion}`);
    userParts.push(`THIS STEP ANSWER (OpenCode):\n${answer.slice(0, 12000)}`);
    userParts.push(
        `Respond JSON only:\n` +
            `{"verdict":"retry_answer"|"needs_followup_question"|"ready_to_synthesize","reason":"string max 200 chars","retryHint":"optional string",` +
            `"globalTaskAssessment":{"allImpliedSubtasksDone":boolean,"finalAnswerDeliverable":boolean,"globalTaskChecklist":"string"}}\n` +
            `- Decompose the GLOBAL TASK into implied subtasks in globalTaskChecklist (plain text; mark done vs pending).\n` +
            `- allImpliedSubtasksDone: true only if every implied subtask is fully satisfied by evidence so far.\n` +
            `- finalAnswerDeliverable: true only if a complete final answer could be written now.\n` +
            `- verdict retry_answer: output wrong, empty, refused, or tools failed; set retryHint.\n` +
            `- verdict needs_followup_question: step OK but more work needed.\n` +
            `- verdict ready_to_synthesize: enough evidence for final answer.`
    );

    const llmResult = await fetchLlmUnified({
        provider: llmConfig.provider,
        apiKey: llmConfig.apiKey,
        apiEndpoint: llmConfig.apiEndpoint,
        model: llmConfig.model,
        messages: [
            { role: 'system', content: 'You verify one OpenCode reasoning step against one global task. JSON only.' },
            { role: 'user', content: userParts.join('\n\n') },
        ],
        temperature: 0.1,
        maxTokens: 900,
        responseFormat: 'json_object',
        headersExtra: llmConfig.customHeaders,
        abortSignal,
    });

    if (!llmResult.success || !llmResult.content) {
        if (abortSignal?.aborted) {
            return { ok: false, cancelled: true, errorReason: 'Cancelled' };
        }
        return {
            ok: true,
            verdict: 'needs_followup_question',
            reason: 'Verifier LLM failed; continue reasoning',
            retryHint: '',
            allImpliedSubtasksDone: false,
            finalAnswerDeliverable: false,
            globalTaskChecklist: '',
        };
    }

    try {
        await trackAnswerMachineTokens(threadId, llmResult.usageStats, username, 'sub_question_answer');
    } catch {
        /* empty */
    }

    try {
        const p = JSON.parse(llmResult.content) as {
            verdict?: string;
            reason?: string;
            retryHint?: string;
            globalTaskAssessment?: unknown;
        };
        const v = p.verdict;
        const verdict: AnswerMachineVerificationVerdictV4 =
            v === 'retry_answer' || v === 'needs_followup_question' || v === 'ready_to_synthesize'
                ? v
                : 'needs_followup_question';
        const g = parseVerifierGlobalAssessment(p);
        return {
            ok: true,
            verdict,
            reason: typeof p.reason === 'string' ? p.reason.slice(0, 200) : '',
            retryHint: typeof p.retryHint === 'string' ? p.retryHint.slice(0, 1500) : '',
            allImpliedSubtasksDone: g.allImpliedSubtasksDone,
            finalAnswerDeliverable: g.finalAnswerDeliverable,
            globalTaskChecklist: g.globalTaskChecklist,
        };
    } catch {
        return {
            ok: true,
            verdict: 'needs_followup_question',
            reason: 'Bad verifier JSON',
            retryHint: '',
            allImpliedSubtasksDone: false,
            finalAnswerDeliverable: false,
            globalTaskChecklist: '',
        };
    }
}

async function ensureOpencodeSessionId(params: {
    client: Awaited<ReturnType<typeof createAm4OpencodeClient>>;
    existingSessionId: string;
    createModel?: { providerID: string; modelID: string };
}): Promise<string | null> {
    const { client, existingSessionId, createModel } = params;
    if (existingSessionId) {
        const g = await client.session.get({ sessionID: existingSessionId });
        if (!g.error && g.data && typeof g.data === 'object' && 'id' in g.data) {
            return existingSessionId;
        }
    }
    const c = await client.session.create({
        title: 'Answer Machine 4 run',
        ...(createModel
            ? { model: { id: createModel.modelID, providerID: createModel.providerID } }
            : {}),
    });
    if (c.error || !c.data || typeof c.data !== 'object' || !('id' in c.data)) {
        return null;
    }
    return (c.data as { id: string }).id;
}

async function patchSubQuestionForRetryV4(
    id: mongoose.Types.ObjectId,
    question: string,
    nextAttemptNumber: number
): Promise<void> {
    await ModelAnswerMachineSubQuestionV4.findByIdAndUpdate(id, {
        $set: {
            status: 'pending',
            question: question.slice(0, 8000),
            attemptNumber: nextAttemptNumber,
            answer: '',
            errorReason: '',
            contextFilesUsed: [],
            promptTokens: 0,
            completionTokens: 0,
            reasoningTokens: 0,
            totalTokens: 0,
            costInUsd: 0,
            updatedAtUtc: new Date(),
        },
        $unset: {
            verificationVerdict: 1,
            verificationReason: 1,
            verificationAllImpliedSubtasksDone: 1,
            verificationFinalAnswerDeliverable: 1,
            verificationGlobalTaskChecklist: 1,
        },
    });
}

const runSequentialReasoningLoopV4 = async ({
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

        if (await tryFinalizeAnswerMachineV4Cancellation({ answerMachineRequestV4Id })) {
            return { success: false, errorReason: 'CancelledByUser', data: null };
        }

        const thread = await ModelChatLlmThread.findOne({
            _id: answerMachineRecord.threadId,
            username: answerMachineRecord.username,
        });
        if (!thread) {
            return { success: false, errorReason: 'Thread not found', data: null };
        }

        const llmConfig = await getLlmConfig({ threadId: answerMachineRecord.threadId });
        if (!llmConfig) {
            return { success: false, errorReason: 'No LLM configuration found', data: null };
        }

        const userApiKeyDoc = await ModelUserApiKey.findOne({ username: answerMachineRecord.username });
        const apiKey = getApiKeyByObject(userApiKeyDoc);
        const shellEngineConfig = getAm4ShellUploadConfig(apiKey);
        const ocCfg = getAm4OpencodeConfig(apiKey);
        if (!ocCfg || !ocCfg.password) {
            return {
                success: false,
                errorReason: 'OpenCode URL and credentials not configured for this user',
                data: null,
            };
        }

        const health = await validateOpencodeHealth(ocCfg.baseUrl, ocCfg.username, ocCfg.password);
        if (!health.ok) {
            return { success: false, errorReason: health.error || 'OpenCode health check failed', data: null };
        }

        const parentMsg = await ModelChatLlm.findById(answerMachineRecord.parentMessageId);
        const originalUserGoalFromParent =
            parentMsg?.type === 'text' && typeof parentMsg.content === 'string'
                ? parentMsg.content.trim()
                : 'Answer the user’s request from conversation context.';
        const globalTaskText =
            (answerMachineRecord.globalTaskDescription || '').trim() || originalUserGoalFromParent;

        const last10 = (await ModelChatLlm.aggregate([
            { $match: { threadId: answerMachineRecord.threadId } },
            { $sort: { createdAtUtc: -1 } },
            { $limit: 10 },
            { $sort: { createdAtUtc: 1 } },
        ])) as IChatLlm[];

        const conversationText = last10
            .filter((m) => m.type === 'text' && m.content)
            .map((m) => `${m.isAi ? 'Assistant' : 'User'}: ${m.content}`)
            .join('\n\n');

        const intermediateAnswersText = (answerMachineRecord.intermediateAnswers || [])
            .filter((a) => a && typeof a === 'string' && a.trim())
            .map((a, i) => `${i + 1}. ${a.trim()}`)
            .join('\n');

        const attachedDocsForSync = await ModelAnswerMachineFileV4.find({
            answerMachineRequestV4Id,
            uploadStatus: 'saved_to_shell',
        }).lean();

        if (shellEngineConfig && userApiKeyDoc) {
            const am4UserProfileDocumentId = String(userApiKeyDoc._id);
            try {
                await ensureAm4ShellWorkDirectoryMarker({
                    shellCfg: shellEngineConfig,
                    userObjectId: am4UserProfileDocumentId,
                    threadId: String(answerMachineRecord.threadId),
                });
                const canonicalInputSyncResult = await syncAm4RequestAttachmentsIntoCanonicalShellLayout({
                    shellCfg: shellEngineConfig,
                    apiKey,
                    username: answerMachineRecord.username,
                    userObjectId: am4UserProfileDocumentId,
                    threadId: answerMachineRecord.threadId,
                    attachments: attachedDocsForSync.map((d) => ({
                        _id: d._id as mongoose.Types.ObjectId,
                        storedFileUrl: d.storedFileUrl,
                        fileName: d.fileName,
                        mimeType: d.mimeType,
                        shellRelativePath: d.shellRelativePath,
                        uploadStatus: d.uploadStatus,
                    })),
                });
                if (canonicalInputSyncResult.errors.length > 0) {
                    console.warn(
                        '[AM4] Canonical shell input sync:',
                        canonicalInputSyncResult.errors.slice(0, 8).join(' | '),
                    );
                }
            } catch (err) {
                console.error('[AM4] Canonical shell input sync failed:', err);
            }
        }

        const attachedDocs = await ModelAnswerMachineFileV4.find({
            answerMachineRequestV4Id,
            uploadStatus: 'saved_to_shell',
            containerPath: { $ne: '' },
        }).lean();

        const attachedFilesSummary =
            attachedDocs.length === 0
                ? ''
                : attachedDocs
                      .map(
                          (d) =>
                              `- ${d.fileName} → read from local absolute path: ${d.containerPath} (mime: ${d.mimeType})`
                      )
                      .join('\n');

        const contextPathsForStep = attachedDocs.map((d) => d.containerPath).filter((p) => p && p.trim());

        const priorRows = await ModelAnswerMachineSubQuestionV4.find({
            answerMachineRequestV4Id,
            status: 'answered',
            answerMachineIteration: { $lt: answerMachineRecord.currentIteration },
        }).sort({ answerMachineIteration: 1, stepIndex: 1, createdAtUtc: 1 });

        const priorText = formatPriorSteps(priorRows.map((r) => r.toObject()));

        if (abortSignal?.aborted) {
            return { success: false, errorReason: 'Cancelled', data: null };
        }

        const planResult = await planNextAm4Step({
            threadId: answerMachineRecord.threadId,
            username: answerMachineRecord.username,
            globalTask: globalTaskText,
            conversationText,
            intermediateAnswersText,
            priorAnsweredStepsText: priorText,
            attachedFilesSummary,
            currentIteration: answerMachineRecord.currentIteration,
            llmConfig,
            abortSignal,
        });

        if (!planResult.ok) {
            if (planResult.cancelled) {
                return { success: false, errorReason: 'Cancelled', data: null };
            }
            return { success: false, errorReason: planResult.errorReason, data: null };
        }

        if (planResult.data.readyToSynthesize) {
            return { success: true, errorReason: '', data: null };
        }

        const workingQuestion = planResult.data.workingQuestion;
        const displayStepIndex = Math.max(0, answerMachineRecord.currentIteration - 1);
        const maxVerifyAttemptsForStep = MAX_VERIFY_RETRIES_PER_STEP;

        let attempt = 0;
        let activeSubId: mongoose.Types.ObjectId | null = null;
        let forceSynthesize = false;
        let advanceStep = false;

        const opencodeClient = await createAm4OpencodeClient(ocCfg.baseUrl, ocCfg.username, ocCfg.password);
        const mappedExecutorModel = opencodeModelFromLlmConfig(llmConfig);
        const opencodeExecutorModel = mappedExecutorModel ?? {
            providerID: AM4_OPENCODE_DEFAULT_EXECUTOR_MODEL.providerID,
            modelID: AM4_OPENCODE_DEFAULT_EXECUTOR_MODEL.modelID,
        };
        await syncAm4OpencodeProviderCredentials(opencodeClient, llmConfig);

        const executorModelKey = `${opencodeExecutorModel.providerID}:${opencodeExecutorModel.modelID}`;
        if (
            answerMachineRecord.opencodeSessionId &&
            (answerMachineRecord.am4OpencodeExecutorModelKey || '') !== executorModelKey
        ) {
            answerMachineRecord.opencodeSessionId = '';
            answerMachineRecord.am4OpencodeExecutorModelKey = '';
            await ModelAnswerMachineRequestV4.findByIdAndUpdate(answerMachineRequestV4Id, {
                $set: {
                    opencodeSessionId: '',
                    am4OpencodeExecutorModelKey: '',
                    updatedAt: new Date(),
                },
            });
        }

        while (attempt < maxVerifyAttemptsForStep && !advanceStep && !forceSynthesize) {
            if (abortSignal?.aborted) {
                return { success: false, errorReason: 'Cancelled', data: null };
            }

            if (await tryFinalizeAnswerMachineV4Cancellation({ answerMachineRequestV4Id })) {
                return { success: false, errorReason: 'CancelledByUser', data: null };
            }

            attempt += 1;

            if (!activeSubId) {
                const created = await ModelAnswerMachineSubQuestionV4.create({
                    threadId: answerMachineRecord.threadId,
                    parentMessageId: answerMachineRecord.parentMessageId,
                    username: answerMachineRecord.username,
                    answerMachineRequestV4Id,
                    answerMachineIteration: answerMachineRecord.currentIteration,
                    question: workingQuestion,
                    answer: '',
                    kind: 'opencode',
                    status: 'pending',
                    stepIndex: displayStepIndex,
                    attemptNumber: attempt,
                    contextFilesUsed: contextPathsForStep,
                });
                activeSubId = created._id as mongoose.Types.ObjectId;
            }

            const sessionId = await ensureOpencodeSessionId({
                client: opencodeClient,
                existingSessionId: answerMachineRecord.opencodeSessionId || '',
                createModel: opencodeExecutorModel,
            });
            if (!sessionId) {
                return { success: false, errorReason: 'Failed to create OpenCode session', data: null };
            }
            if (sessionId !== answerMachineRecord.opencodeSessionId || (answerMachineRecord.am4OpencodeExecutorModelKey || '') !== executorModelKey) {
                answerMachineRecord.opencodeSessionId = sessionId;
                answerMachineRecord.am4OpencodeExecutorModelKey = executorModelKey;
                await ModelAnswerMachineRequestV4.findByIdAndUpdate(answerMachineRequestV4Id, {
                    $set: {
                        opencodeSessionId: sessionId,
                        am4OpencodeExecutorModelKey: executorModelKey,
                        updatedAt: new Date(),
                    },
                });
            }

            const qDoc = await ModelAnswerMachineSubQuestionV4.findById(activeSubId).lean();
            const qText = qDoc?.question || workingQuestion;

            const fileBlock =
                attachedFilesSummary.trim().length > 0
                    ? `USER FILES (already on disk in the shared workspace / container):\n${attachedFilesSummary}\n\nYou MUST read these files from the given absolute paths using Python or Node.js inside OpenCode. Do not claim the user did not upload them.\n\n`
                    : '';

            const promptBody =
                `${fileBlock}` +
                `GLOBAL TASK:\n${globalTaskText}\n\n` +
                `OUTER ITERATION: ${answerMachineRecord.currentIteration} of ${answerMachineRecord.maxNumberOfIterations}.\n\n` +
                `CURRENT STEP:\n${qText}\n\n` +
                `Constraints: Use OpenCode capabilities only. Do not delegate file reading to an external “shell upload” service. Prefer deterministic tool use. Avoid infinite loops.`;

            const am4ShellOutputDirectoryHint =
                shellEngineConfig && userApiKeyDoc
                    ? `\n\nDELIVERABLE FILES: Save any new user-visible artifacts under \`/ai-notes-xyz-shell-files/${String(userApiKeyDoc._id)}/chat/${String(answerMachineRecord.threadId)}/outputfile/<filename.ext>\` (same path as shell relative key \`ai-notes-xyz-shell-files/${String(userApiKeyDoc._id)}/chat/${String(answerMachineRecord.threadId)}/outputfile/<filename.ext>\`). Mention each filename in your final answer text.`
                    : '';

            const executorSystemWithWorkspaceHints = `${AM4_OPENCODE_EXECUTOR_SYSTEM}${am4ShellOutputDirectoryHint}`;

            const promptOutcome = await runAm4SessionPromptAndCollectAssistant({
                client: opencodeClient,
                sessionID: sessionId,
                promptBody,
                system: executorSystemWithWorkspaceHints,
                model: opencodeExecutorModel,
                executorModelSource: mappedExecutorModel ? 'thread' : 'default',
                threadLlmModelRaw: llmConfig.model,
            });

            if (!promptOutcome.ok) {
                const msg = promptOutcome.error;
                await ModelAnswerMachineSubQuestionV4.findByIdAndUpdate(activeSubId, {
                    $set: {
                        status: 'error',
                        errorReason: msg.slice(0, 2000),
                        updatedAtUtc: new Date(),
                    },
                });
                return { success: false, errorReason: msg, data: null };
            }

            const assistantText = promptOutcome.text;
            await ModelAnswerMachineSubQuestionV4.findByIdAndUpdate(activeSubId, {
                $set: {
                    answer: assistantText,
                    status: 'answered',
                    contextFilesUsed: contextPathsForStep,
                    updatedAtUtc: new Date(),
                },
            });

            if (shellEngineConfig && userApiKeyDoc) {
                try {
                    const outputSync = await syncAm4AssistantOutputFilesFromShellToUserStorage({
                        shellCfg: shellEngineConfig,
                        apiKey,
                        username: answerMachineRecord.username,
                        userObjectId: String(userApiKeyDoc._id),
                        threadId: answerMachineRecord.threadId,
                        answerMachineRequestV4Id,
                        assistantAnswerText: assistantText,
                    });
                    if (outputSync.attemptLog.length > 0) {
                        console.log('[AM4] Output file sync:', outputSync.attemptLog.join('; '));
                    }
                } catch (err) {
                    console.error('[AM4] Output file sync error:', err);
                }
            }

            const aText = assistantText;
            const ver = await verifySequentialStepAm4({
                threadId: answerMachineRecord.threadId,
                username: answerMachineRecord.username,
                globalTaskDescription: globalTaskText,
                cumulativePriorStepsText: priorText,
                maxOuterIterations: answerMachineRecord.maxNumberOfIterations,
                currentOuterIteration: answerMachineRecord.currentIteration,
                workingQuestion: qText,
                answer: aText,
                llmConfig,
                abortSignal,
            });

            if (!ver.ok) {
                if (ver.cancelled) {
                    return { success: false, errorReason: 'Cancelled', data: null };
                }
                return { success: false, errorReason: 'Verifier error', data: null };
            }

            await ModelAnswerMachineSubQuestionV4.findByIdAndUpdate(activeSubId, {
                $set: {
                    verificationVerdict: ver.verdict,
                    verificationReason: ver.reason,
                    verificationAllImpliedSubtasksDone: ver.allImpliedSubtasksDone,
                    verificationFinalAnswerDeliverable: ver.finalAnswerDeliverable,
                    verificationGlobalTaskChecklist: ver.globalTaskChecklist,
                    updatedAtUtc: new Date(),
                },
            });

            if (ver.verdict === 'ready_to_synthesize') {
                forceSynthesize = true;
                break;
            }

            if (ver.verdict === 'retry_answer' && attempt < maxVerifyAttemptsForStep) {
                const hint = ver.retryHint.trim();
                const refined =
                    hint.length > 0
                        ? `${qText}\n\n(Refine using this guidance: ${hint})`
                        : `${qText}\n\n(Retry: previous answer was insufficient.)`;
                await patchSubQuestionForRetryV4(activeSubId, refined, attempt + 1);
                continue;
            }

            advanceStep = true;
        }

        return { success: true, errorReason: '', data: null };
    } catch (error) {
        console.error(`❌ AM4 runSequentialReasoningLoopV4 (request ${answerMachineRequestV4Id}):`, error);
        return {
            success: false,
            errorReason: error instanceof Error ? error.message : 'Internal server error',
            data: null,
        };
    }
};

export default runSequentialReasoningLoopV4;
