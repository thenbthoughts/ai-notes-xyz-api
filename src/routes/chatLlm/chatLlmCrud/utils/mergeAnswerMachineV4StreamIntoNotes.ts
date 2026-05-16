import mongoose from 'mongoose';

import { ModelChatLlmThread } from '../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelAnswerMachineRequestV4 } from '../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineRequestV4.schema';
import { ModelAnswerMachineSubQuestionV4 } from '../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineSubQuestionV4.schema';
import { ModelAnswerMachineFileV4 } from '../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineFileV4.schema';
import { ModelAnswerMachineEvaluateAnswerV4 } from '../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineEvaluateAnswerV4.schema';
import { am4SyntheticIterationDocId } from '../answerMachineV4/am4SyntheticIteration';

export type AnswerMachineV4AttachedFileMeta = {
    fileDocId: string;
    fileName: string;
    mimeType: string;
    containerPath: string;
    shellRelativePath: string;
    uploadStatus: string;
    fileRole: string;
    storedFileUrl: string;
};

export type AnswerMachineV4StreamPayload =
    | {
          kind: 'iteration';
          iterationDocId: string;
          requestId: string;
          iterationNumber: number;
          status: string;
          errorReason: string;
          priorIterationEvaluationReason: string;
          priorIterationDraftExcerpt: string;
          priorIterationWasSatisfactory: boolean | null;
          globalTaskDescriptionExcerpt: string;
          outerIterationMax: number;
          outerIterationsRemaining: number;
          opencodeSessionId: string;
          attachedFiles: AnswerMachineV4AttachedFileMeta[];
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
          contextFilesUsed?: string[];
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
          containerPath: string;
          shellRelativePath: string;
          uploadStatus: string;
          fileRole: string;
      };

const STREAM_TYPE = 'answer_machine_v4_stream' as const;

function toTime(v: unknown): number {
    const t = new Date(v as string | Date).getTime();
    return Number.isNaN(t) ? NaN : t;
}

function toAttachedMeta(d: {
    _id: unknown;
    fileName?: string;
    mimeType?: string;
    containerPath?: string;
    shellRelativePath?: string;
    uploadStatus?: string;
    fileRole?: string;
    storedFileUrl?: string;
}): AnswerMachineV4AttachedFileMeta {
    return {
        fileDocId: String(d._id),
        fileName: (d.fileName || 'file').slice(0, 500),
        mimeType: (d.mimeType || 'application/octet-stream').slice(0, 200),
        containerPath: (d.containerPath || '').slice(0, 4000),
        shellRelativePath: (d.shellRelativePath || '').slice(0, 4000),
        uploadStatus: String(d.uploadStatus || ''),
        fileRole: String(d.fileRole || ''),
        storedFileUrl: (d.storedFileUrl || '').slice(0, 4000),
    };
}

/**
 * Interleaves Answer Machine V4 iteration + sub-question rows with chat messages for the same
 * thread, scoped to the time range of the chat page (so pagination stays chat-based).
 */
export async function mergeAnswerMachineV4StreamIntoNotes(params: {
    username: string;
    threadId: mongoose.Types.ObjectId;
    chatDocs: Record<string, unknown>[];
}): Promise<Record<string, unknown>[]> {
    const { username, threadId, chatDocs } = params;
    if (chatDocs.length === 0) {
        return chatDocs;
    }

    const thread = await ModelChatLlmThread.findOne({ _id: threadId, username }).select('answerEngine').lean();
    if (!thread || thread.answerEngine !== 'answerMachine4') {
        return chatDocs;
    }

    const times = chatDocs.map((d) => toTime(d.createdAtUtc)).filter((t) => !Number.isNaN(t));
    if (times.length === 0) {
        return chatDocs;
    }

    const tMin = new Date(Math.min(...times));
    const tMax = new Date(Math.max(...times));
    const tUpper = new Date(Math.max(tMax.getTime(), Date.now()));

    const requests = await ModelAnswerMachineRequestV4.find({ threadId, username }).select('_id').lean();
    const requestIds = requests.map((r) => r._id);
    if (requestIds.length === 0) {
        return chatDocs;
    }

    const [subQuestions, am4Evaluations, am4RequestSnapshots, allFilesForRequests] = await Promise.all([
        ModelAnswerMachineSubQuestionV4.find({
            threadId,
            username,
            createdAtUtc: { $gte: tMin, $lte: tUpper },
        }).lean(),
        ModelAnswerMachineEvaluateAnswerV4.find({
            threadId,
            username,
            answerMachineRequestV4Id: { $in: requestIds },
        })
            .select('answerMachineRequestV4Id evaluationReason isSatisfactory createdAtUtc')
            .lean(),
        ModelAnswerMachineRequestV4.find({
            _id: { $in: requestIds },
            threadId,
            username,
        })
            .select(
                'intermediateAnswers globalTaskDescription maxNumberOfIterations attachedFiles opencodeSessionId status currentIteration createdAt cancellationRequestedUtc',
            )
            .lean(),
        ModelAnswerMachineFileV4.find({
            answerMachineRequestV4Id: { $in: requestIds },
        }).lean(),
    ]);

    const evaluationsByRequestId = new Map<
        string,
        Array<{ evaluationReason: string; isSatisfactory: boolean; createdAtUtc?: Date }>
    >();
    for (const ev of am4Evaluations) {
        const rid = String(ev.answerMachineRequestV4Id);
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
        { globalTaskDescription: string; maxNumberOfIterations: number; opencodeSessionId: string }
    >();
    const intermediateAnswersByRequestId = new Map<string, string[]>();
    const attachedMetaByRequestId = new Map<string, AnswerMachineV4AttachedFileMeta[]>();

    for (const row of am4RequestSnapshots) {
        const id = String(row._id);
        const g =
            typeof (row as { globalTaskDescription?: string }).globalTaskDescription === 'string'
                ? (row as { globalTaskDescription: string }).globalTaskDescription
                : '';
        const maxIt = (row as { maxNumberOfIterations?: number }).maxNumberOfIterations;
        const ocSidRaw =
            typeof (row as { opencodeSessionId?: string }).opencodeSessionId === 'string'
                ? (row as { opencodeSessionId: string }).opencodeSessionId
                : '';
        const ocSid = ocSidRaw.trim().slice(0, 500);
        requestMetaById.set(id, {
            globalTaskDescription: g,
            maxNumberOfIterations:
                typeof maxIt === 'number' && Number.isFinite(maxIt) ? Math.max(1, Math.floor(maxIt)) : 10,
            opencodeSessionId: ocSid,
        });
        intermediateAnswersByRequestId.set(
            id,
            Array.isArray(row.intermediateAnswers)
                ? row.intermediateAnswers.filter((x): x is string => typeof x === 'string')
                : [],
        );
        attachedMetaByRequestId.set(id, []);
    }

    for (const f of allFilesForRequests) {
        const rid = f.answerMachineRequestV4Id ? String(f.answerMachineRequestV4Id) : '';
        if (!rid || !attachedMetaByRequestId.has(rid)) {
            continue;
        }
        const bucket = attachedMetaByRequestId.get(rid) ?? [];
        bucket.push(toAttachedMeta(f));
        attachedMetaByRequestId.set(rid, bucket);
    }

    const streamRows: Record<string, unknown>[] = [];

    const iterKeyToGroup = new Map<string, (typeof subQuestions)[number][]>();
    for (const sq of subQuestions) {
        const rk = `${sq.answerMachineRequestV4Id}|${sq.answerMachineIteration}`;
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
        const iterDocId = am4SyntheticIterationDocId(reqIdStr, iterationNumber);
        const tsArr = group.map((s) => toTime(s.createdAtUtc)).filter((t) => !Number.isNaN(t));
        const minT = tsArr.length ? Math.min(...tsArr) : Date.now();
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

    const synthIterKey = (requestId: string, iterationNumber: number) => `${requestId}|${iterationNumber}`;
    const coveredBySubQuestions = new Set(synthIters.map((s) => synthIterKey(s.requestId, s.iterationNumber)));

    let pendingOnlySeq = 0;
    for (const row of am4RequestSnapshots) {
        const rid = String((row as { _id: unknown })._id);
        const rowStatus = (row as { status?: string }).status;
        if (rowStatus !== 'pending') {
            continue;
        }
        const curRaw = (row as { currentIteration?: number }).currentIteration;
        const curIt =
            typeof curRaw === 'number' && Number.isFinite(curRaw) ? Math.max(1, Math.floor(curRaw)) : 1;
        if (coveredBySubQuestions.has(synthIterKey(rid, curIt))) {
            continue;
        }

        pendingOnlySeq += 1;
        const createdAt = (row as { createdAt?: Date }).createdAt;
        const tsMs =
            createdAt instanceof Date && !Number.isNaN(createdAt.getTime()) ? createdAt.getTime() : Date.now();
        const sortMs = Math.max(tsMs, tMax.getTime()) + pendingOnlySeq;
        const cancelAt = (row as { cancellationRequestedUtc?: Date | null }).cancellationRequestedUtc;
        const cancelPending = cancelAt != null && cancelAt instanceof Date && !Number.isNaN(cancelAt.getTime());

        synthIters.push({
            iterDocId: am4SyntheticIterationDocId(rid, curIt),
            requestId: rid,
            iterationNumber: curIt,
            ts: new Date(sortMs),
            status: cancelPending ? 'in_progress' : 'queued',
            errorReason: '',
        });
        coveredBySubQuestions.add(synthIterKey(rid, curIt));
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

        const allAttached = attachedMetaByRequestId.get(meta.requestId) ?? [];
        const iterationAttached = allAttached.filter((x) => x.fileRole === 'user_attachment');

        const ocSession = (reqMeta?.opencodeSessionId ?? '').trim();

        streamRows.push({
            _id: `am4-iter-${meta.iterDocId}`,
            type: STREAM_TYPE,
            threadId,
            streamPayload: {
                kind: 'iteration',
                iterationDocId: meta.iterDocId,
                requestId: meta.requestId,
                iterationNumber: meta.iterationNumber,
                status: meta.status,
                errorReason: meta.errorReason,
                priorIterationEvaluationReason,
                priorIterationDraftExcerpt,
                priorIterationWasSatisfactory,
                globalTaskDescriptionExcerpt,
                outerIterationMax,
                outerIterationsRemaining,
                opencodeSessionId: ocSession,
                attachedFiles: iterationAttached,
            } satisfies AnswerMachineV4StreamPayload,
            content: `Answer Machine 4 · Iteration ${meta.iterationNumber} · ${meta.status}`,
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
        const ctx =
            Array.isArray(sq.contextFilesUsed) && sq.contextFilesUsed.length > 0
                ? sq.contextFilesUsed.filter((p): p is string => typeof p === 'string' && p.trim() !== '').slice(0, 40)
                : undefined;
        streamRows.push({
            _id: `am4-sq-${String(sq._id)}`,
            type: STREAM_TYPE,
            threadId,
            streamPayload: {
                kind: 'sub_question',
                iterationDocId: am4SyntheticIterationDocId(String(sq.answerMachineRequestV4Id), sq.answerMachineIteration),
                requestId: String(sq.answerMachineRequestV4Id),
                iterationNumber: sq.answerMachineIteration,
                question: q,
                answer: a,
                status: sq.status,
                subKind: sq.kind || 'opencode',
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
                contextFilesUsed: ctx,
            } satisfies AnswerMachineV4StreamPayload,
            content:
                typeof sq.stepIndex === 'number'
                    ? `Answer Machine 4 · Step ${sq.stepIndex} (${sq.kind || 'opencode'}) · ${sq.status}`
                    : `Answer Machine 4 · Sub-question (${sq.kind || 'opencode'}) · ${sq.status}`,
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
            promptTokens: sq.promptTokens ?? 0,
            completionTokens: sq.completionTokens ?? 0,
            reasoningTokens: sq.reasoningTokens ?? 0,
            totalTokens: sq.totalTokens ?? 0,
            costInUsd: sq.costInUsd ?? 0,
        });
    }

    const fileArtifacts = await ModelAnswerMachineFileV4.find({
        threadId,
        username,
        answerMachineRequestV4Id: { $in: requestIds },
        createdAtUtc: { $gte: tMin, $lte: tUpper },
    })
        .sort({ createdAtUtc: 1, _id: 1 })
        .lean();

    for (const f of fileArtifacts) {
        const ts = (f.createdAtUtc ?? new Date()) as Date;
        const fileIterationDocId = '';
        streamRows.push({
            _id: `am4-file-${String(f._id)}`,
            type: STREAM_TYPE,
            threadId,
            streamPayload: {
                kind: 'file_artifact',
                requestId: String(f.answerMachineRequestV4Id),
                fileDocId: String(f._id),
                iterationDocId: fileIterationDocId,
                subQuestionDocId: '',
                storedFileUrl: (f.storedFileUrl || '').slice(0, 4000),
                mimeType: (f.mimeType || 'application/octet-stream').slice(0, 200),
                originalName: (f.fileName || 'file').slice(0, 500),
                purpose: String(f.fileRole || 'attachment').slice(0, 80),
                description: '',
                fileType: String(f.fileRole || 'attachment').slice(0, 40),
                containerPath: (f.containerPath || '').slice(0, 4000),
                shellRelativePath: (f.shellRelativePath || '').slice(0, 4000),
                uploadStatus: String(f.uploadStatus || ''),
                fileRole: String(f.fileRole || ''),
            } satisfies AnswerMachineV4StreamPayload,
            content: `Answer Machine 4 · File · ${f.fileName || 'artifact'}`,
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
        activeRequestIdStrings.add(String(sq.answerMachineRequestV4Id));
    }
    for (const f of fileArtifacts) {
        activeRequestIdStrings.add(String(f.answerMachineRequestV4Id));
    }

    const latestPipelineTs = streamRows.reduce((acc, row) => {
        const t = toTime(row.createdAtUtc);
        return Number.isNaN(t) ? acc : Math.max(acc, t);
    }, tMin.getTime());

    let bump = 0;
    if (activeRequestIdStrings.size > 0) {
        const reqObjectIds = [...activeRequestIdStrings].map((id) => new mongoose.Types.ObjectId(id));

        const evalRowsWithChatNote = await ModelAnswerMachineEvaluateAnswerV4.find({
            answerMachineRequestV4Id: { $in: reqObjectIds },
            username,
            threadId,
            insertedChatMessageId: { $ne: null },
        })
            .select('answerMachineRequestV4Id')
            .lean();
        const skipAm4FinalBecauseChatNoteExists = new Set(
            evalRowsWithChatNote.map((r) => String(r.answerMachineRequestV4Id)),
        );

        const reqsWithFinal = await ModelAnswerMachineRequestV4.find({
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
            if (skipAm4FinalBecauseChatNoteExists.has(String(req._id))) {
                continue;
            }
            bump += 1;
            const ts = new Date(Math.max(latestPipelineTs, tMax.getTime()) + bump);
            streamRows.push({
                _id: `am4-final-${String(req._id)}`,
                type: STREAM_TYPE,
                threadId,
                streamPayload: {
                    kind: 'final_answer',
                    requestId: String(req._id),
                    answerText: fa.slice(0, 120_000),
                } satisfies AnswerMachineV4StreamPayload,
                content: 'Answer Machine 4 · Final answer',
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
