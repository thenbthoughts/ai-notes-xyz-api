import mongoose, { PipelineStage } from 'mongoose';

import { ModelChatLlmThread } from '../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';

/** Normalized row from chatLlmThread $unionWith answerMachineRequestV3 */
export interface AnswerMachineRequestV3UnionThreadItem {
    unionKind: 'thread' | 'am3_request';
    sortAt: string;
    thread?: {
        _id: string;
        threadTitle: string;
        answerEngine: string;
        createdAtUtc: string | null;
        updatedAtUtc: string | null;
    };
    request?: {
        _id: string;
        parentMessageId: string;
        status: string;
        errorReason: string;
        currentIteration: number;
        maxNumberOfIterations: number;
        totalTokens: number;
        costInUsd: number;
        createdAt: string;
        updatedAt: string;
    };
}

function iso(v: unknown): string {
    if (v instanceof Date) return v.toISOString();
    if (v == null) return new Date(0).toISOString();
    const d = new Date(v as string);
    return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

export function serializeAnswerMachineUnionRows(raw: Record<string, unknown>[]): AnswerMachineRequestV3UnionThreadItem[] {
    return raw.map((row) => {
        const unionKind = row.unionKind as 'thread' | 'am3_request';
        const sortAt = iso(row.sortAt);

        if (unionKind === 'thread') {
            const t = row.thread as Record<string, unknown>;
            return {
                unionKind,
                sortAt,
                thread: {
                    _id: String(t._id),
                    threadTitle: (t.threadTitle as string) ?? '',
                    answerEngine: (t.answerEngine as string) ?? '',
                    createdAtUtc: t.createdAtUtc ? iso(t.createdAtUtc) : null,
                    updatedAtUtc: t.updatedAtUtc ? iso(t.updatedAtUtc) : null,
                },
            };
        }

        const r = row.request as Record<string, unknown>;
        return {
            unionKind,
            sortAt,
            request: {
                _id: String(r._id),
                parentMessageId: String(r.parentMessageId),
                status: (r.status as string) ?? '',
                errorReason: ((r.errorReason as string) ?? '').slice(0, 500),
                currentIteration: Number(r.currentIteration ?? 0),
                maxNumberOfIterations: Number(r.maxNumberOfIterations ?? 0),
                totalTokens: Number(r.totalTokens ?? 0),
                costInUsd: Number(r.costInUsd ?? 0),
                createdAt: iso(r.createdAt),
                updatedAt: iso(r.updatedAt),
            },
        };
    });
}

/**
 * MongoDB aggregate: chatLlmThread (single doc) $unionWith answerMachineRequestV3 for thread,
 * sorted by sortAt ascending.
 */
export async function aggregateAnswerMachineRequestV3UnionThread(params: {
    username: string;
    threadId: mongoose.Types.ObjectId;
}): Promise<AnswerMachineRequestV3UnionThreadItem[]> {
    const { username, threadId } = params;

    const ok = await ModelChatLlmThread.findOne({ _id: threadId, username }).select('_id').lean();
    if (!ok) {
        return [];
    }

    const pipeline: PipelineStage[] = [
        { $match: { _id: threadId, username } },
        { $limit: 1 },
        {
            $project: {
                _id: 0,
                unionKind: { $literal: 'thread' },
                sortAt: {
                    $ifNull: ['$createdAtUtc', '$updatedAtUtc'],
                },
                thread: {
                    _id: '$_id',
                    threadTitle: 1,
                    answerEngine: 1,
                    createdAtUtc: 1,
                    updatedAtUtc: 1,
                },
            },
        },
        {
            $unionWith: {
                coll: 'answerMachineRequestV3',
                pipeline: [
                    {
                        $match: {
                            threadId,
                            username,
                        },
                    },
                    {
                        $project: {
                            unionKind: { $literal: 'am3_request' },
                            sortAt: '$createdAt',
                            request: {
                                _id: '$_id',
                                parentMessageId: 1,
                                status: 1,
                                errorReason: 1,
                                currentIteration: 1,
                                maxNumberOfIterations: 1,
                                totalTokens: 1,
                                costInUsd: 1,
                                createdAt: 1,
                                updatedAt: 1,
                            },
                        },
                    },
                ],
            },
        },
        { $sort: { sortAt: 1 as const } },
    ];

    const rows = await ModelChatLlmThread.aggregate(pipeline);
    return serializeAnswerMachineUnionRows(rows as Record<string, unknown>[]);
}
