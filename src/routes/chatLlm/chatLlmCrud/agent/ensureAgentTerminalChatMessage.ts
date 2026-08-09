import mongoose from 'mongoose';

import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelAgentInstance } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentInstance.schema';
import { ModelAgentGoal } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentGoal.schema';
import { ModelAgentMemory } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentMemory.schema';
import { persistAgentFinalWithCitations } from './agentFinalPersist';

const CHAT_IN_PROGRESS = 'AI generating in progress';

export const agentRunTag = (agentInstanceId: mongoose.Types.ObjectId | string): string =>
    `agent-run:${String(agentInstanceId)}`;

const isIncompleteFinalContent = (content: string | undefined | null): boolean => {
    const c = (content || '').trim();
    if (!c) return true;
    return c.includes(CHAT_IN_PROGRESS);
};

/**
 * Guarantee a visible final chat message when an agent run ends (success or failed).
 * Idempotent: skips if a completed final already exists for this run.
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

    const existingTagged = await ModelChatLlm.find({
        threadId,
        userId,
        tags: runTag,
        isAi: true,
    })
        .sort({ createdAtUtc: -1 })
        .limit(5)
        .lean();

    const completedExisting = existingTagged.find(
        (m) =>
            Array.isArray(m.tags) &&
            m.tags.includes('final_answer') &&
            !isIncompleteFinalContent(m.content)
    );
    if (completedExisting?._id) {
        return { chatMessageId: completedExisting._id as mongoose.Types.ObjectId, created: false };
    }

    // Streaming / incomplete placeholder for this run
    const incomplete = existingTagged.find(
        (m) =>
            Array.isArray(m.tags) &&
            m.tags.includes('final_answer') &&
            isIncompleteFinalContent(m.content)
    );

    const goals = await ModelAgentGoal.find({ agentInstanceId }).sort({ orderIndex: 1 }).lean();
    const completedGoals = goals.filter((g) => g.status === 'completed');
    const lastGoalResult = completedGoals
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

    const tags = ['agent', 'final_answer', runTag, outcome === 'failed' ? 'agent_failed' : 'agent_success'];

    if (incomplete?._id) {
        await ModelChatLlm.findByIdAndUpdate(incomplete._id, {
            $set: {
                content: body,
                tags,
                updatedAtUtc: new Date(),
            },
        });

        await persistAgentFinalWithCitations({
            chatMessageId: incomplete._id as mongoose.Types.ObjectId,
            agentInstanceId,
            userId,
            threadId,
            researchBrief: briefMem?.content || '',
            confidence: outcome === 'success' ? 'medium' : 'low',
            citations: [],
        });

        return { chatMessageId: incomplete._id as mongoose.Types.ObjectId, created: false };
    }

    // Also reclaim any recent streaming final without run tag (legacy path)
    const recentStream = await ModelChatLlm.findOne({
        threadId,
        userId,
        isAi: true,
        tags: 'final_answer',
        createdAtUtc: { $gte: agent.createdAtUtc || new Date(0) },
        content: { $regex: CHAT_IN_PROGRESS },
    })
        .sort({ createdAtUtc: -1 })
        .lean();

    if (recentStream?._id) {
        await ModelChatLlm.findByIdAndUpdate(recentStream._id, {
            $set: {
                content: body,
                tags,
                updatedAtUtc: new Date(),
            },
        });
        await persistAgentFinalWithCitations({
            chatMessageId: recentStream._id as mongoose.Types.ObjectId,
            agentInstanceId,
            userId,
            threadId,
            researchBrief: briefMem?.content || '',
            confidence: outcome === 'success' ? 'medium' : 'low',
            citations: [],
        });
        return { chatMessageId: recentStream._id as mongoose.Types.ObjectId, created: false };
    }

    const created = await ModelChatLlm.create({
        type: 'text',
        content: body,
        userId: userId.toString(),
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

    return { chatMessageId: created._id as mongoose.Types.ObjectId, created: true };
};
