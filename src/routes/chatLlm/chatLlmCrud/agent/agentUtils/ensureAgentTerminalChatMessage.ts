import mongoose from 'mongoose';

import { ModelChatLlm } from '../../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelAgentInstance } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentInstance.schema';
import { ModelAgentGoal } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentGoal.schema';
import { ModelAgentMemory } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentMemory.schema';
import { persistAgentFinalWithCitations } from '../agentWork/agentFinalPersist';

const CHAT_IN_PROGRESS = 'AI generating in progress';

export const agentRunTag = (agentInstanceId: mongoose.Types.ObjectId | string): string =>
    `agent-run:${String(agentInstanceId)}`;

const isIncompleteFinalContent = (content: string | undefined | null): boolean => {
    const c = (content || '').trim();
    if (!c) return true;
    return c.includes(CHAT_IN_PROGRESS);
};

type LeanChat = {
    _id: mongoose.Types.ObjectId;
    content?: string;
    tags?: string[];
    createdAtUtc?: Date;
};

/**
 * Find every chat row for this agent run (by run tag). Do not filter userId —
 * synthesize stores userId as string cast and mismatches used to create duplicates.
 */
const findRunChatMessages = async (params: {
    threadId: mongoose.Types.ObjectId;
    runTag: string;
    since?: Date | null;
}): Promise<LeanChat[]> => {
    const { threadId, runTag, since } = params;
    const q: Record<string, unknown> = {
        threadId,
        isAi: true,
        tags: runTag,
    };
    if (since) {
        q.createdAtUtc = { $gte: since };
    }
    return (await ModelChatLlm.find(q).sort({ createdAtUtc: -1 }).limit(30).lean()) as LeanChat[];
};

/**
 * Keep a single final chat message for the run; delete the rest (streaming + duplicate finals).
 */
const dedupeRunFinalMessages = async (params: {
    messages: LeanChat[];
    keepId: mongoose.Types.ObjectId | string;
}): Promise<void> => {
    const keep = String(params.keepId);
    for (const m of params.messages) {
        if (!m?._id || String(m._id) === keep) continue;
        const tags = Array.isArray(m.tags) ? m.tags : [];
        if (!tags.includes('finalize') && !tags.includes('streaming')) continue;
        try {
            await ModelChatLlm.findByIdAndDelete(m._id);
        } catch (e) {
            console.error('Failed to delete duplicate agent final message:', e);
        }
    }
};

/**
 * Guarantee exactly one visible final chat message when an agent run ends.
 * Idempotent: reuses/dedupes existing finals for this run tag; never leaves a second copy.
 */
export const ensureAgentTerminalChatMessage = async (params: {
    agentInstanceId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    outcome: 'success' | 'failed';
    reason?: string;
}): Promise<{ chatMessageId: mongoose.Types.ObjectId | null; created: boolean }> => {
    const { agentInstanceId, userId, threadId, outcome } = params;
    const runTag = agentRunTag(agentInstanceId);

    const agent = await ModelAgentInstance.findById(agentInstanceId).lean();
    if (!agent) {
        return { chatMessageId: null, created: false };
    }

    const existingTagged = await findRunChatMessages({
        threadId,
        runTag,
        since: agent.createdAtUtc || null,
    });

    const recentStreams = (await ModelChatLlm.find({
        threadId,
        isAi: true,
        tags: 'finalize',
        createdAtUtc: { $gte: agent.createdAtUtc || new Date(0) },
        content: { $regex: CHAT_IN_PROGRESS },
    })
        .sort({ createdAtUtc: -1 })
        .limit(10)
        .lean()) as LeanChat[];

    const byId = new Map<string, LeanChat>();
    for (const m of [...existingTagged, ...recentStreams]) {
        if (m?._id) byId.set(String(m._id), m);
    }
    const allRelated = Array.from(byId.values());

    const completedExisting = allRelated
        .filter(
            (m) =>
                Array.isArray(m.tags) &&
                m.tags.includes('finalize') &&
                !isIncompleteFinalContent(m.content)
        )
        .sort((a, b) => {
            // Prefer longest completed answer, then newest
            const lenDiff = (b.content || '').length - (a.content || '').length;
            if (lenDiff !== 0) return lenDiff;
            return (b.createdAtUtc?.getTime() || 0) - (a.createdAtUtc?.getTime() || 0);
        });

    const incompletes = allRelated.filter(
        (m) =>
            Array.isArray(m.tags) &&
            (m.tags.includes('finalize') || m.tags.includes('streaming')) &&
            isIncompleteFinalContent(m.content)
    );

    const goals = await ModelAgentGoal.find({ agentInstanceId }).sort({ orderIndex: 1 }).lean();
    const completedGoals = goals.filter((g) => g.status === 'completed');
    const topLevelResults = completedGoals
        .filter((g) => !g.parentGoalId)
        .map((g) => (g.result || '').trim())
        .filter(Boolean);
    const lastGoalResult =
        topLevelResults.slice(-1)[0] ||
        completedGoals
            .map((g) => (g.result || '').trim())
            .filter(Boolean)
            .slice(-1)[0];

    const briefMem = await ModelAgentMemory.findOne({
        agentInstanceId,
        key: 'research_brief',
    })
        .sort({ createdAtUtc: -1 })
        .lean();

    let body = '';
    if (outcome === 'success') {
        if (lastGoalResult) {
            body = lastGoalResult.slice(0, 12000);
        } else if (completedExisting[0]?.content && !isIncompleteFinalContent(completedExisting[0].content)) {
            body = String(completedExisting[0].content).slice(0, 12000);
        } else if (briefMem?.content) {
            body =
                `Here's what I found before finishing:\n\n${briefMem.content.slice(0, 6000)}`.slice(
                    0,
                    12000
                );
        } else {
            body =
                agent.summary?.trim() ||
                'Agent finished successfully, but no detailed answer was produced.';
        }
    } else {
        const reason =
            (params.reason || '').trim() ||
            (agent.errorReason || '').trim() ||
            (agent.cancellationRequestedUtc
                ? 'Stopped by user.'
                : 'Agent run failed before producing a final answer.');
        const partial =
            lastGoalResult ||
            (briefMem?.content
                ? `\n\nPartial findings:\n${briefMem.content.slice(0, 3000)}`
                : '');
        body = (
            `**Agent ended (failed)**\n\n${reason}${partial}\n\n` +
            `You can send the question again, or adjust thread settings (model, shell permission) and retry.`
        ).slice(0, 12000);
    }

    const tags = [
        'agent',
        'finalize',
        runTag,
        outcome === 'failed' ? 'agent_failed' : 'agent_success',
    ];

    // Already have a completed final → keep one, delete every other final/stream for this run.
    if (completedExisting[0]?._id) {
        const keepId = completedExisting[0]._id as mongoose.Types.ObjectId;
        // Normalize tags on the keeper (ensure agent_success / agent_failed)
        await ModelChatLlm.findByIdAndUpdate(keepId, {
            $set: {
                tags,
                // Prefer goal result body when richer / for failures
                content:
                    outcome === 'failed' ||
                    (body && body.length > String(completedExisting[0].content || '').length)
                        ? body
                        : completedExisting[0].content,
                updatedAtUtc: new Date(),
            },
        });
        await dedupeRunFinalMessages({ messages: allRelated, keepId });
        return { chatMessageId: keepId, created: false };
    }

    // Reclaim a streaming placeholder
    if (incompletes[0]?._id) {
        const keepId = incompletes[0]._id as mongoose.Types.ObjectId;
        await ModelChatLlm.findByIdAndUpdate(keepId, {
            $set: {
                content: body,
                tags,
                updatedAtUtc: new Date(),
            },
        });
        await dedupeRunFinalMessages({ messages: allRelated, keepId });
        await persistAgentFinalWithCitations({
            chatMessageId: keepId,
            agentInstanceId,
            userId,
            threadId,
            researchBrief: briefMem?.content || '',
            confidence: outcome === 'success' ? 'medium' : 'low',
            citations: [],
        });
        return { chatMessageId: keepId, created: false };
    }

    const created = await ModelChatLlm.create({
        type: 'text',
        content: body,
        userId,
        threadId,
        isAi: true,
        tags,
        createdAtUtc: new Date(),
        updatedAtUtc: new Date(),
    });

    await persistAgentFinalWithCitations({
        chatMessageId: created._id as mongoose.Types.ObjectId,
        agentInstanceId,
        userId,
        threadId,
        researchBrief: briefMem?.content || '',
        confidence: outcome === 'success' ? 'medium' : 'low',
        citations: [],
    });

    // Safety: if anything else slipped in, remove it
    const after = await findRunChatMessages({ threadId, runTag });
    await dedupeRunFinalMessages({
        messages: after,
        keepId: created._id as mongoose.Types.ObjectId,
    });

    return { chatMessageId: created._id as mongoose.Types.ObjectId, created: true };
};
