import mongoose from 'mongoose';

import { ModelChatLlmThread } from '../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelAnswerMachineRequestV3 } from '../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineRequestV3.schema';
import { ModelAnswerMachineSubQuestionV3 } from '../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineSubQuestionV3.schema';
import { ModelAnswerMachineFileV3 } from '../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineFileV3.schema';
import { ModelAnswerMachinePipelineVisualV3 } from '../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachinePipelineVisualV3.schema';
import { ModelAnswerMachineEvaluateAnswerV3 } from '../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineEvaluateAnswerV3.schema';
import { am3SyntheticIterationDocId } from '../answerMachineV3/am3SyntheticIteration';

export type AnswerMachineV3StreamPayload =
    | {
          kind: 'iteration';
          iterationDocId: string;
          requestId: string;
          iterationNumber: number;
          status: string;
          errorReason: string;
          inputImageStoredFileUrl: string;
          outputImageStoredFileUrl: string;
          /**
           * Context carried into this outer iteration from the previous one (evaluator + draft).
           * Filled when `iterationNumber >= 2`; relies on one `answerMachineEvaluateAnswerV3` doc per completed
           * outer iteration per request, sorted by `createdAtUtc`.
           */
          priorIterationEvaluationReason: string;
          priorIterationDraftExcerpt: string;
          priorIterationWasSatisfactory: boolean | null;
          globalTaskDescriptionExcerpt: string;
          outerIterationMax: number;
          outerIterationsRemaining: number;
      }
    | {
          kind: 'sub_question';
          iterationDocId: string;
          requestId: string;
          iterationNumber: number;
          question: string;
          answer: string;
          status: string;
          subKind: string;
          stepIndex?: number;
          attemptNumber?: number;
          verificationVerdict?: string;
          verificationReason?: string;
          verificationAllImpliedSubtasksDone?: boolean;
          verificationFinalAnswerDeliverable?: boolean;
          verificationGlobalTaskChecklist?: string;
          /** Last shell command actually run (retry-aware). */
          executedShellCommand?: string;
          shellExecutionSuccess?: boolean;
          shellExecutionExitCode?: number | null;
          shellExecutionTimedOut?: boolean;
          shellExecutionStderrPreview?: string;
          shellRetryGuidance?: string;
      }
    | {
          kind: 'final_answer';
          requestId: string;
          answerText: string;
      }
    | {
          kind: 'file_artifact';
          requestId: string;
          fileDocId: string;
          iterationDocId: string;
          subQuestionDocId: string;
          storedFileUrl: string;
          mimeType: string;
          originalName: string;
          purpose: string;
          description: string;
          fileType: string;
      };

const STREAM_TYPE = 'answer_machine_v3_stream' as const;

function toTime(v: unknown): number {
    const t = new Date(v as string | Date).getTime();
    return Number.isNaN(t) ? NaN : t;
}

/**
 * Interleaves Answer Machine V3 iteration + sub-question rows with chat messages for the same
 * thread, scoped to the time range of the chat page (so pagination stays chat-based).
 */
export async function mergeAnswerMachineV3StreamIntoNotes(params: {
    username: string;
    threadId: mongoose.Types.ObjectId;
    chatDocs: Record<string, unknown>[];
}): Promise<Record<string, unknown>[]> {
    const { username, threadId, chatDocs } = params;
    if (chatDocs.length === 0) {
        return chatDocs;
    }

    const thread = await ModelChatLlmThread.findOne({ _id: threadId, username }).select('answerEngine').lean();
    if (!thread || thread.answerEngine !== 'answerMachine3') {
        return chatDocs;
    }

    const times = chatDocs.map((d) => toTime(d.createdAtUtc)).filter((t) => !Number.isNaN(t));
    if (times.length === 0) {
        return chatDocs;
    }

    const tMin = new Date(Math.min(...times));
    const tMax = new Date(Math.max(...times));
    /** Newest loaded chat row can lag behind AM3 docs created during an in-flight step; widen upper bound to "now". */
    const tUpper = new Date(Math.max(tMax.getTime(), Date.now()));

    const requests = await ModelAnswerMachineRequestV3.find({ threadId, username }).select('_id').lean();
    const requestIds = requests.map((r) => r._id);
    if (requestIds.length === 0) {
        return chatDocs;
    }

    const [subQuestions, pipelineVisuals, am3Evaluations, am3RequestSnapshots] = await Promise.all([
        ModelAnswerMachineSubQuestionV3.find({
            threadId,
            username,
            createdAtUtc: { $gte: tMin, $lte: tUpper },
        }).lean(),
        ModelAnswerMachinePipelineVisualV3.find({
            threadId,
            username,
            answerMachineRequestV3Id: { $in: requestIds },
        }).lean(),
        ModelAnswerMachineEvaluateAnswerV3.find({
            threadId,
            username,
            answerMachineRequestV3Id: { $in: requestIds },
        })
            .select('answerMachineRequestV3Id evaluationReason isSatisfactory createdAtUtc')
            .lean(),
        ModelAnswerMachineRequestV3.find({
            _id: { $in: requestIds },
            threadId,
            username,
        })
            .select('intermediateAnswers globalTaskDescription maxNumberOfIterations')
            .lean(),
    ]);

    /** Per-request evaluation history in chronological order (see iteration payload `priorIteration*` fields). */
    const evaluationsByRequestId = new Map<
        string,
        Array<{ evaluationReason: string; isSatisfactory: boolean; createdAtUtc?: Date }>
    >();
    for (const ev of am3Evaluations) {
        const rid = String(ev.answerMachineRequestV3Id);
        const list = evaluationsByRequestId.get(rid) ?? [];
        list.push({
            evaluationReason: typeof ev.evaluationReason === 'string' ? ev.evaluationReason : '',
            isSatisfactory: Boolean(ev.isSatisfactory),
            createdAtUtc: ev.createdAtUtc as Date | undefined,
        });
        evaluationsByRequestId.set(rid, list);
    }
    for (const [, list] of evaluationsByRequestId) {
        list.sort((a, b) => toTime(a.createdAtUtc) - toTime(b.createdAtUtc));
    }

    const requestMetaById = new Map<
        string,
        { globalTaskDescription: string; maxNumberOfIterations: number }
    >();
    const intermediateAnswersByRequestId = new Map<string, string[]>();
    for (const row of am3RequestSnapshots) {
        const id = String(row._id);
        const g =
            typeof (row as { globalTaskDescription?: string }).globalTaskDescription === 'string'
                ? (row as { globalTaskDescription: string }).globalTaskDescription
                : '';
        const maxIt = (row as { maxNumberOfIterations?: number }).maxNumberOfIterations;
        requestMetaById.set(id, {
            globalTaskDescription: g,
            maxNumberOfIterations:
                typeof maxIt === 'number' && Number.isFinite(maxIt) ? Math.max(1, Math.floor(maxIt)) : 10,
        });
        intermediateAnswersByRequestId.set(
            id,
            Array.isArray(row.intermediateAnswers)
                ? row.intermediateAnswers.filter((x): x is string => typeof x === 'string')
                : [],
        );
    }

    const pipelineVisualByIterKey = new Map<string, { inUrl: string; outUrl: string }>();
    for (const v of pipelineVisuals) {
        const k = `${String(v.answerMachineRequestV3Id)}|${v.answerMachineIteration}`;
        pipelineVisualByIterKey.set(k, {
            inUrl: (v.inputImageStoredFileUrl || '').slice(0, 4000),
            outUrl: (v.outputImageStoredFileUrl || '').slice(0, 4000),
        });
    }

    const streamRows: Record<string, unknown>[] = [];

    const iterKeyToGroup = new Map<string, (typeof subQuestions)[number][]>();
    for (const sq of subQuestions) {
        const rk = `${sq.answerMachineRequestV3Id}|${sq.answerMachineIteration}`;
        const g = iterKeyToGroup.get(rk) ?? [];
        g.push(sq);
        iterKeyToGroup.set(rk, g);
    }

    type SynthMeta = {
        iterDocId: string;
        requestId: string;
        iterationNumber: number;
        ts: Date;
        status: string;
        errorReason: string;
    };
    const synthIters: SynthMeta[] = [];
    for (const [rk, group] of iterKeyToGroup) {
        const [reqIdStr, iterStr] = rk.split('|');
        const iterationNumber = Number(iterStr);
        const iterDocId = am3SyntheticIterationDocId(reqIdStr, iterationNumber);
        const times = group.map((s) => toTime(s.createdAtUtc)).filter((t) => !Number.isNaN(t));
        const minT = times.length ? Math.min(...times) : Date.now();
        const hasPending = group.some((s) => s.status === 'pending');
        const status = hasPending ? 'in_progress' : 'completed';
        const firstErr = group.find((s) => s.status === 'error' && (s.errorReason || '').trim())?.errorReason;
        synthIters.push({
            iterDocId,
            requestId: reqIdStr,
            iterationNumber,
            ts: new Date(minT - 1),
            status,
            errorReason: (firstErr || '').slice(0, 2000),
        });
    }
    synthIters.sort((a, b) => {
        if (a.requestId !== b.requestId) {
            return a.requestId.localeCompare(b.requestId);
        }
        if (a.iterationNumber !== b.iterationNumber) {
            return a.iterationNumber - b.iterationNumber;
        }
        return a.ts.getTime() - b.ts.getTime();
    });

    for (const meta of synthIters) {
        const visualKey = `${meta.requestId}|${meta.iterationNumber}`;
        const vis = pipelineVisualByIterKey.get(visualKey);

        const priorIdx = meta.iterationNumber - 2;
        let priorIterationEvaluationReason = '';
        let priorIterationDraftExcerpt = '';
        let priorIterationWasSatisfactory: boolean | null = null;
        if (meta.iterationNumber >= 2 && priorIdx >= 0) {
            const evalHistory = evaluationsByRequestId.get(meta.requestId) ?? [];
            const ev = evalHistory[priorIdx];
            if (ev) {
                priorIterationEvaluationReason = (ev.evaluationReason || '').slice(0, 500);
                priorIterationWasSatisfactory = ev.isSatisfactory;
            }
            const drafts = intermediateAnswersByRequestId.get(meta.requestId) ?? [];
            const draft = drafts[priorIdx];
            if (typeof draft === 'string' && draft.trim()) {
                priorIterationDraftExcerpt = draft.trim().slice(0, 1200);
            }
        }

        const reqMeta = requestMetaById.get(meta.requestId);
        const outerIterationMax = reqMeta?.maxNumberOfIterations ?? 10;
        const globalTaskDescriptionExcerpt = (reqMeta?.globalTaskDescription ?? '').trim().slice(0, 800);
        const outerIterationsRemaining = Math.max(0, outerIterationMax - meta.iterationNumber);

        streamRows.push({
            _id: `am3-iter-${meta.iterDocId}`,
            type: STREAM_TYPE,
            threadId,
            streamPayload: {
                kind: 'iteration',
                iterationDocId: meta.iterDocId,
                requestId: meta.requestId,
                iterationNumber: meta.iterationNumber,
                status: meta.status,
                errorReason: meta.errorReason,
                inputImageStoredFileUrl: vis?.inUrl ?? '',
                outputImageStoredFileUrl: vis?.outUrl ?? '',
                priorIterationEvaluationReason,
                priorIterationDraftExcerpt,
                priorIterationWasSatisfactory,
                globalTaskDescriptionExcerpt,
                outerIterationMax,
                outerIterationsRemaining,
            },
            content: `Answer Machine 3 · Iteration ${meta.iterationNumber} · ${meta.status}`,
            reasoningContent: '',
            username,
            tags: [],
            visibility: '',
            fileUrlArr: [],
            fileUrl: '',
            fileContentText: '',
            fileContentAi: '',
            isAi: true,
            aiModelName: '',
            aiModelProvider: '',
            userAgent: '',
            tagsAutoAi: [],
            createdAtUtc: meta.ts,
            createdAtIpAddress: '',
            createdAtUserAgent: '',
            updatedAtUtc: meta.ts,
            updatedAtIpAddress: '',
            updatedAtUserAgent: '',
            promptTokens: 0,
            completionTokens: 0,
            reasoningTokens: 0,
            totalTokens: 0,
            costInUsd: 0,
        });
    }

    for (const sq of subQuestions) {
        const ts = (sq.createdAtUtc ?? sq.updatedAtUtc ?? new Date()) as Date;
        const q = (sq.question || '').slice(0, 4000);
        const a = (sq.answer || '').slice(0, 16000);
        streamRows.push({
            _id: `am3-sq-${String(sq._id)}`,
            type: STREAM_TYPE,
            threadId,
            streamPayload: {
                kind: 'sub_question',
                iterationDocId: am3SyntheticIterationDocId(
                    String(sq.answerMachineRequestV3Id),
                    sq.answerMachineIteration
                ),
                requestId: String(sq.answerMachineRequestV3Id),
                iterationNumber: sq.answerMachineIteration,
                question: q,
                answer: a,
                status: sq.status,
                subKind: sq.kind || '',
                stepIndex: typeof sq.stepIndex === 'number' ? sq.stepIndex : undefined,
                attemptNumber: typeof sq.attemptNumber === 'number' ? sq.attemptNumber : undefined,
                verificationVerdict: typeof sq.verificationVerdict === 'string' ? sq.verificationVerdict : undefined,
                verificationReason:
                    typeof sq.verificationReason === 'string' ? sq.verificationReason.slice(0, 500) : undefined,
                verificationAllImpliedSubtasksDone:
                    typeof sq.verificationAllImpliedSubtasksDone === 'boolean'
                        ? sq.verificationAllImpliedSubtasksDone
                        : undefined,
                verificationFinalAnswerDeliverable:
                    typeof sq.verificationFinalAnswerDeliverable === 'boolean'
                        ? sq.verificationFinalAnswerDeliverable
                        : undefined,
                verificationGlobalTaskChecklist:
                    typeof sq.verificationGlobalTaskChecklist === 'string'
                        ? sq.verificationGlobalTaskChecklist.slice(0, 2000)
                        : undefined,
                executedShellCommand:
                    sq.kind === 'shell' && typeof sq.executedShellCommand === 'string'
                        ? sq.executedShellCommand.slice(0, 4000)
                        : undefined,
                shellExecutionSuccess:
                    sq.kind === 'shell' && typeof sq.shellExecutionSuccess === 'boolean'
                        ? sq.shellExecutionSuccess
                        : undefined,
                shellExecutionExitCode:
                    sq.kind === 'shell' &&
                    (typeof sq.shellExecutionExitCode === 'number' || sq.shellExecutionExitCode === null)
                        ? sq.shellExecutionExitCode
                        : undefined,
                shellExecutionTimedOut:
                    sq.kind === 'shell' && typeof sq.shellExecutionTimedOut === 'boolean'
                        ? sq.shellExecutionTimedOut
                        : undefined,
                shellExecutionStderrPreview:
                    sq.kind === 'shell' && typeof sq.shellExecutionStderrPreview === 'string'
                        ? sq.shellExecutionStderrPreview.slice(0, 1500)
                        : undefined,
                shellRetryGuidance:
                    sq.kind === 'shell' && typeof sq.shellRetryGuidance === 'string'
                        ? sq.shellRetryGuidance.slice(0, 2000)
                        : undefined,
            },
            content:
                typeof sq.stepIndex === 'number'
                    ? `Answer Machine 3 · Step ${sq.stepIndex} (${sq.kind || 'unknown'}) · ${sq.status}`
                    : `Answer Machine 3 · Sub-question (${sq.kind || 'unknown'}) · ${sq.status}`,
            reasoningContent: '',
            username,
            tags: [],
            visibility: '',
            fileUrlArr: [],
            fileUrl: '',
            fileContentText: '',
            fileContentAi: '',
            isAi: true,
            aiModelName: '',
            aiModelProvider: '',
            userAgent: '',
            tagsAutoAi: [],
            createdAtUtc: ts,
            createdAtIpAddress: '',
            createdAtUserAgent: '',
            updatedAtUtc: ts,
            updatedAtIpAddress: '',
            updatedAtUserAgent: '',
            promptTokens: sq.totalTokens ?? 0,
            completionTokens: sq.completionTokens ?? 0,
            reasoningTokens: sq.reasoningTokens ?? 0,
            totalTokens: sq.totalTokens ?? 0,
            costInUsd: sq.costInUsd ?? 0,
        });
    }

    const fileArtifacts = await ModelAnswerMachineFileV3.find({
        threadId,
        username,
        answerMachineRequestV3Id: { $in: requestIds },
        createdAtUtc: { $gte: tMin, $lte: tUpper },
    })
        .sort({ createdAtUtc: 1, _id: 1 })
        .lean();

    for (const f of fileArtifacts) {
        const ts = (f.createdAtUtc ?? new Date()) as Date;
        let fileIterationDocId = '';
        if (typeof f.answerMachineIteration === 'number' && Number.isFinite(f.answerMachineIteration)) {
            fileIterationDocId = am3SyntheticIterationDocId(String(f.answerMachineRequestV3Id), f.answerMachineIteration);
        } else if (f.answerMachineSubQuestionV3Id) {
            const sid = String(f.answerMachineSubQuestionV3Id);
            const linked = subQuestions.find((s) => String(s._id) === sid);
            if (linked) {
                fileIterationDocId = am3SyntheticIterationDocId(
                    String(linked.answerMachineRequestV3Id),
                    linked.answerMachineIteration
                );
            }
        }
        streamRows.push({
            _id: `am3-file-${String(f._id)}`,
            type: STREAM_TYPE,
            threadId,
            streamPayload: {
                kind: 'file_artifact',
                requestId: String(f.answerMachineRequestV3Id),
                fileDocId: String(f._id),
                iterationDocId: fileIterationDocId,
                subQuestionDocId: f.answerMachineSubQuestionV3Id ? String(f.answerMachineSubQuestionV3Id) : '',
                storedFileUrl: (f.storedFileUrl || '').slice(0, 4000),
                mimeType: (f.mimeType || 'application/octet-stream').slice(0, 200),
                originalName: (f.originalName || 'file').slice(0, 500),
                purpose: String(f.purpose || 'other').slice(0, 80),
                description: (f.description || '').slice(0, 2000),
                fileType: String(f.fileType || 'generated').slice(0, 40),
            },
            content: `Answer Machine 3 · File · ${f.originalName || 'artifact'}`,
            reasoningContent: '',
            username,
            tags: [],
            visibility: '',
            fileUrlArr: [],
            fileUrl: '',
            fileContentText: '',
            fileContentAi: '',
            isAi: true,
            aiModelName: '',
            aiModelProvider: '',
            userAgent: '',
            tagsAutoAi: [],
            createdAtUtc: ts,
            createdAtIpAddress: '',
            createdAtUserAgent: '',
            updatedAtUtc: ts,
            updatedAtIpAddress: '',
            updatedAtUserAgent: '',
            promptTokens: 0,
            completionTokens: 0,
            reasoningTokens: 0,
            totalTokens: 0,
            costInUsd: 0,
        });
    }

    const activeRequestIdStrings = new Set<string>();
    for (const sq of subQuestions) {
        activeRequestIdStrings.add(String(sq.answerMachineRequestV3Id));
    }
    for (const f of fileArtifacts) {
        activeRequestIdStrings.add(String(f.answerMachineRequestV3Id));
    }

    const latestPipelineTs = streamRows.reduce((acc, row) => {
        const t = toTime(row.createdAtUtc);
        return Number.isNaN(t) ? acc : Math.max(acc, t);
    }, tMin.getTime());

    let bump = 0;
    if (activeRequestIdStrings.size > 0) {
        const reqObjectIds = [...activeRequestIdStrings].map((id) => new mongoose.Types.ObjectId(id));
        const reqsWithFinal = await ModelAnswerMachineRequestV3.find({
            _id: { $in: reqObjectIds },
            username,
            threadId,
        })
            .select('finalAnswer updatedAt createdAt')
            .lean();

        const sortedFinalReqs = [...reqsWithFinal].sort((a, b) => String(a._id).localeCompare(String(b._id)));
        for (const req of sortedFinalReqs) {
            const fa = (req.finalAnswer || '').trim();
            if (!fa) continue;
            bump += 1;
            const ts = new Date(Math.max(latestPipelineTs, tMax.getTime()) + bump);
            streamRows.push({
                _id: `am3-final-${String(req._id)}`,
                type: STREAM_TYPE,
                threadId,
                streamPayload: {
                    kind: 'final_answer',
                    requestId: String(req._id),
                    answerText: fa.slice(0, 120_000),
                },
                content: 'Answer Machine 3 · Final answer',
                reasoningContent: '',
                username,
                tags: [],
                visibility: '',
                fileUrlArr: [],
                fileUrl: '',
                fileContentText: '',
                fileContentAi: '',
                isAi: true,
                aiModelName: '',
                aiModelProvider: '',
                userAgent: '',
                tagsAutoAi: [],
                createdAtUtc: ts,
                createdAtIpAddress: '',
                createdAtUserAgent: '',
                updatedAtUtc: ts,
                updatedAtIpAddress: '',
                updatedAtUserAgent: '',
                promptTokens: 0,
                completionTokens: 0,
                reasoningTokens: 0,
                totalTokens: 0,
                costInUsd: 0,
            });
        }
    }

    const merged: Record<string, unknown>[] = [...chatDocs, ...streamRows];

    merged.sort((a, b) => {
        let ta = toTime(a.createdAtUtc);
        let tb = toTime(b.createdAtUtc);
        if (Number.isNaN(ta)) ta = 0;
        if (Number.isNaN(tb)) tb = 0;
        if (ta !== tb) {
            return ta - tb;
        }
        return String(a._id).localeCompare(String(b._id));
    });

    return merged;
}
