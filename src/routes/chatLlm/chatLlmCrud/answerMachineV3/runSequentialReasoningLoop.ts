import mongoose from 'mongoose';

import { ModelAnswerMachineRequestV3 } from '../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineRequestV3.schema';
import { ModelAnswerMachineSubQuestionV3 } from '../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineSubQuestionV3.schema';
import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelChatLlmThread } from '../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { IChatLlm } from '../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types';
import {
    AnswerMachineKbKnowledgeTypeV3,
    AnswerMachineSubQuestionKindV3,
    AnswerMachineVerificationVerdictV3,
} from '../../../../types/typesSchema/typesChatLlm/typesAnswerMachine/SchemaAnswerMachineSubQuestionV3.types';
import fetchLlmUnified from '../../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { getLlmConfig } from '../answerMachineV2/helperFunction/answerMachineGetLlmConfig';
import { trackAnswerMachineTokens } from '../answerMachineV2/helperFunction/tokenTracking';
import { coercePlannedAm3Step } from './am3SingleStepCoercion';
import { answerOneSubQuestionById } from './step3AnswerSubQuestions/step3AnswerSubQuestions';

const KB_TYPES: AnswerMachineKbKnowledgeTypeV3[] = [
    'shortTermMemory',
    'notes',
    'tasks',
    'lifeEvents',
    'infoVault',
    'memoNotes',
];

const SUB_KINDS: AnswerMachineSubQuestionKindV3[] = ['knowledgeBase', 'shell', 'web'];

const MAX_VERIFY_RETRIES_PER_STEP = 3;

function normalizePlanned(raw: unknown): {
    readyToSynthesize: boolean;
    workingQuestion: string;
    kind: AnswerMachineSubQuestionKindV3;
    kbKnowledgeTypes: AnswerMachineKbKnowledgeTypeV3[];
} | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const readyToSynthesize = o.readyToSynthesize === true;
    const workingQuestion = typeof o.workingQuestion === 'string' ? o.workingQuestion.trim() : '';
    const kindRaw = typeof o.kind === 'string' ? o.kind.trim() : 'knowledgeBase';
    const kind = SUB_KINDS.includes(kindRaw as AnswerMachineSubQuestionKindV3)
        ? (kindRaw as AnswerMachineSubQuestionKindV3)
        : 'knowledgeBase';
    let kbKnowledgeTypes: AnswerMachineKbKnowledgeTypeV3[] = [];
    if (Array.isArray(o.kbKnowledgeTypes)) {
        kbKnowledgeTypes = o.kbKnowledgeTypes.filter(
            (t): t is AnswerMachineKbKnowledgeTypeV3 => typeof t === 'string' && (KB_TYPES as string[]).includes(t)
        );
    }
    if (kind === 'knowledgeBase' && kbKnowledgeTypes.length === 0) {
        kbKnowledgeTypes = [...KB_TYPES];
    }
    if (readyToSynthesize) {
        return { readyToSynthesize: true, workingQuestion: '', kind: 'knowledgeBase', kbKnowledgeTypes: [] };
    }
    if (!workingQuestion) return null;
    return { readyToSynthesize: false, workingQuestion, kind, kbKnowledgeTypes };
}

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

type PlannerOutput =
    | {
          readyToSynthesize: true;
          workingQuestion: string;
          kind: AnswerMachineSubQuestionKindV3;
          kbKnowledgeTypes: AnswerMachineKbKnowledgeTypeV3[];
      }
    | {
          readyToSynthesize: false;
          workingQuestion: string;
          kind: AnswerMachineSubQuestionKindV3;
          kbKnowledgeTypes: AnswerMachineKbKnowledgeTypeV3[];
      };

async function planNextSequentialStep(params: {
    threadId: mongoose.Types.ObjectId;
    username: string;
    originalUserGoal: string;
    conversationText: string;
    intermediateAnswersText: string;
    priorAnsweredStepsText: string;
    currentIteration: number;
    llmConfig: NonNullable<Awaited<ReturnType<typeof getLlmConfig>>>;
    abortSignal?: AbortSignal;
}): Promise<
    | { ok: true; data: PlannerOutput }
    | { ok: false; cancelled: boolean; errorReason: string }
> {
    const {
        threadId,
        username,
        originalUserGoal,
        conversationText,
        intermediateAnswersText,
        priorAnsweredStepsText,
        currentIteration,
        llmConfig,
        abortSignal,
    } = params;

    let sys = `You plan the next single action for Answer Machine 3 (sequential reasoning).\n`;
    sys += `Reply with JSON only:\n`;
    sys += `{"readyToSynthesize":boolean,"workingQuestion":string,"kind":"knowledgeBase"|"shell"|"web","kbKnowledgeTypes":string[]}\n`;
    sys += `- If the user's goal is already fully satisfied by prior steps below, set readyToSynthesize true (other fields can be empty strings / empty array).\n`;
    sys += `- Otherwise readyToSynthesize false and provide exactly ONE focused workingQuestion for this step.\n`;
    sys += `- kind "knowledgeBase": personal KB; kbKnowledgeTypes must be a non-empty subset of: shortTermMemory, notes, tasks, lifeEvents, infoVault, memoNotes. Use [] only when kind is not knowledgeBase.\n`;
    sys += `- kind "shell": sandbox terminal — you may install (apt/npm/venv+pip) and run CLI tools. **Tool order:** Node.js first, Python 3 second (only if Node is awkward), other CLIs third. Each command must **terminate** (no infinite loops, fork bombs, or daemons that never exit) because runs are time-limited. For screenshots use headless **chromium** only — never chromium-browser, never apt install chromium-browser. REQUIRED for arithmetic and live page capture.\n`;
    sys += `- kind "web": text-style external knowledge without executing a live browser capture.\n`;
    if (currentIteration > 1) {
        sys += `This is outer iteration ${currentIteration}; prior outer attempts may have left intermediate answers — still pick one next step or synthesize if done.\n`;
    }

    const userParts: string[] = [];
    userParts.push(`GLOBAL TASK:\n${originalUserGoal}`);
    if (conversationText) userParts.push(`CONVERSATION:\n${conversationText}`);
    if (intermediateAnswersText) userParts.push(`PRIOR OUTER ITERATION DRAFTS:\n${intermediateAnswersText}`);
    if (priorAnsweredStepsText) userParts.push(`COMPLETED STEPS FROM PRIOR OUTER ITERATIONS:\n${priorAnsweredStepsText}`);
    userParts.push(
        `You are planning for **outer iteration ${currentIteration} only**: emit at most **one** workingQuestion for this iteration (or readyToSynthesize). Further steps are handled by later outer iterations.`
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

    const norm = normalizePlanned(parsed);
    if (!norm) {
        return { ok: false, cancelled: false, errorReason: 'Planner returned unusable data' };
    }
    return { ok: true, data: norm as PlannerOutput };
}

async function verifySequentialStep(params: {
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
          verdict: AnswerMachineVerificationVerdictV3;
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
    userParts.push(`THIS STEP ANSWER:\n${answer.slice(0, 12000)}`);
    userParts.push(
        `Respond JSON only:\n` +
            `{"verdict":"retry_answer"|"needs_followup_question"|"ready_to_synthesize","reason":"string max 200 chars","retryHint":"optional string",` +
            `"globalTaskAssessment":{"allImpliedSubtasksDone":boolean,"finalAnswerDeliverable":boolean,"globalTaskChecklist":"string"}}\n` +
            `- Decompose the GLOBAL TASK into implied subtasks in globalTaskChecklist (plain text; mark done vs pending per what prior steps + this answer satisfy).\n` +
            `- allImpliedSubtasksDone: true only if every implied subtask is fully satisfied by evidence so far.\n` +
            `- finalAnswerDeliverable: true only if a complete, correct final user-facing answer could be written now from evidence so far (align with verdict: use ready_to_synthesize only when this is true).\n` +
            `- verdict retry_answer: this step's output is wrong, empty, refused, or tool failed; set retryHint with what to fix.\n` +
            `- verdict needs_followup_question: this step is acceptable but more work is needed toward the GLOBAL TASK.\n` +
            `- verdict ready_to_synthesize: enough evidence to write the final user-facing answer for the GLOBAL TASK.`
    );

    const llmResult = await fetchLlmUnified({
        provider: llmConfig.provider,
        apiKey: llmConfig.apiKey,
        apiEndpoint: llmConfig.apiEndpoint,
        model: llmConfig.model,
        messages: [
            { role: 'system', content: 'You verify one reasoning step against one global task. JSON only.' },
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
        const verdict: AnswerMachineVerificationVerdictV3 =
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

const runSequentialReasoningLoop = async ({
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

        const lastUserPlain =
            parentMsg && !parentMsg.isAi && typeof parentMsg.content === 'string'
                ? parentMsg.content.trim()
                : '';

        const priorRows = await ModelAnswerMachineSubQuestionV3.find({
            answerMachineRequestV3Id,
            status: 'answered',
            answerMachineIteration: { $lt: answerMachineRecord.currentIteration },
        }).sort({ answerMachineIteration: 1, stepIndex: 1, createdAtUtc: 1 });

        const priorText = formatPriorSteps(priorRows.map((r) => r.toObject()));

        if (abortSignal?.aborted) {
            return { success: false, errorReason: 'Cancelled', data: null };
        }

        const planResult = await planNextSequentialStep({
            threadId: answerMachineRecord.threadId,
            username: answerMachineRecord.username,
            originalUserGoal: globalTaskText,
            conversationText,
            intermediateAnswersText,
            priorAnsweredStepsText: priorText,
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

        const coerced = coercePlannedAm3Step(
            {
                question: planResult.data.workingQuestion,
                kind: planResult.data.kind,
                kbKnowledgeTypes: planResult.data.kbKnowledgeTypes,
            },
            lastUserPlain
        );

        const displayStepIndex = Math.max(0, answerMachineRecord.currentIteration - 1);

        /** One primary shell run per shell sub-question (user can put long `bash -c '…'`); KB/web keep verifier retries. */
        const maxVerifyAttemptsForStep = coerced.kind === 'shell' ? 1 : MAX_VERIFY_RETRIES_PER_STEP;

        let attempt = 0;
        let activeSubId: mongoose.Types.ObjectId | null = null;
        let forceSynthesize = false;
        let advanceStep = false;

        while (attempt < maxVerifyAttemptsForStep && !advanceStep && !forceSynthesize) {
            if (abortSignal?.aborted) {
                return { success: false, errorReason: 'Cancelled', data: null };
            }

            attempt += 1;

            if (!activeSubId) {
                const created = await ModelAnswerMachineSubQuestionV3.create({
                    threadId: answerMachineRecord.threadId,
                    parentMessageId: answerMachineRecord.parentMessageId,
                    username: answerMachineRecord.username,
                    answerMachineRequestV3Id,
                    answerMachineIteration: answerMachineRecord.currentIteration,
                    question: coerced.question,
                    answer: '',
                    kind: coerced.kind,
                    kbKnowledgeTypes: coerced.kind === 'knowledgeBase' ? coerced.kbKnowledgeTypes : [],
                    status: 'pending',
                    stepIndex: displayStepIndex,
                    attemptNumber: attempt,
                });
                activeSubId = created._id as mongoose.Types.ObjectId;
            }

            const ans = await answerOneSubQuestionById({ subQuestionId: activeSubId, abortSignal });
            if (ans.cancelled) {
                return { success: false, errorReason: 'Cancelled', data: null };
            }
            if (!ans.ok) {
                return { success: false, errorReason: ans.errorReason || 'Step answer failed', data: null };
            }

            const answeredDoc = await ModelAnswerMachineSubQuestionV3.findById(activeSubId).lean();
            const qText = answeredDoc?.question || coerced.question;
            const aText = answeredDoc?.answer || '';

            const ver = await verifySequentialStep({
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

            await ModelAnswerMachineSubQuestionV3.findByIdAndUpdate(activeSubId, {
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
                const shellGuidance =
                    answeredDoc?.kind === 'shell' ? (answeredDoc.shellRetryGuidance ?? '').trim() : '';
                const hint = ver.retryHint.trim();
                const mergedHint = (() => {
                    if (!shellGuidance) {
                        return hint;
                    }
                    if (!hint) {
                        return shellGuidance;
                    }
                    if (hint.includes(shellGuidance) || shellGuidance.includes(hint)) {
                        return hint.length >= shellGuidance.length ? hint : shellGuidance;
                    }
                    return `${shellGuidance} ${hint}`;
                })();
                const refined =
                    mergedHint.length > 0
                        ? `${qText}\n\n(Refine using this guidance: ${mergedHint})`
                        : `${qText}\n\n(Retry: previous answer was insufficient.)`;
                await patchSubQuestionForRetry(activeSubId, refined, attempt + 1);
                continue;
            }

            advanceStep = true;
        }

        return { success: true, errorReason: '', data: null };
    } catch (error) {
        console.error(`❌ AM3 runSequentialReasoningLoop (request ${answerMachineRequestV3Id}):`, error);
        return {
            success: false,
            errorReason: error instanceof Error ? error.message : 'Internal server error',
            data: null,
        };
    }
};

async function patchSubQuestionForRetry(
    id: mongoose.Types.ObjectId,
    question: string,
    nextAttemptNumber: number
): Promise<void> {
    await ModelAnswerMachineSubQuestionV3.findByIdAndUpdate(id, {
        $set: {
            status: 'pending',
            question: question.slice(0, 8000),
            attemptNumber: nextAttemptNumber,
            answer: '',
            contextIds: [],
            shellArtifactSummary: '',
            webResearchNotes: '',
            errorReason: '',
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

export default runSequentialReasoningLoop;
