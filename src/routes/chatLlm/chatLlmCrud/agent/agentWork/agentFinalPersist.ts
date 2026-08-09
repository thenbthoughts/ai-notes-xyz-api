import mongoose from 'mongoose';

import { ModelAgentFinal } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentFinal.schema';
import { ModelAgentCitation } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentCitation.schema';

export type AgentFinalCitationInput = {
    source: string;
    id: string;
    title: string;
    summary: string;
};

/** Persist normalized agent final + citation rows (replaces embedded agentFinalArtifactV1). */
export const persistAgentFinalWithCitations = async (params: {
    chatMessageId: mongoose.Types.ObjectId;
    agentInstanceId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    goalId?: mongoose.Types.ObjectId | null;
    researchBrief?: string;
    confidence?: 'low' | 'medium' | 'high';
    citations: AgentFinalCitationInput[];
}): Promise<void> => {
    const {
        chatMessageId,
        agentInstanceId,
        userId,
        threadId,
        goalId,
        researchBrief,
        confidence,
        citations,
    } = params;

    const resolvedConfidence =
        confidence ||
        (citations.length >= 3 ? 'high' : citations.length >= 1 ? 'medium' : 'low');

    // Replace prior rows for this chat message (re-synthesize / overwrite)
    const existing = await ModelAgentFinal.findOne({ chatMessageId }).select('_id').lean();
    if (existing?._id) {
        await ModelAgentCitation.deleteMany({ agentFinalId: existing._id });
        await ModelAgentFinal.deleteOne({ _id: existing._id });
    }

    const finalDoc = await ModelAgentFinal.create({
        chatMessageId,
        agentInstanceId,
        userId,
        threadId,
        goalId: goalId || null,
        version: 1,
        kind: 'agent_final',
        researchBrief: (researchBrief || '').slice(0, 4000),
        confidence: resolvedConfidence,
        createdAtUtc: new Date(),
        updatedAtUtc: new Date(),
    });

    const unique = new Map<string, AgentFinalCitationInput>();
    for (const c of citations) {
        if (!c?.source || !c?.id) continue;
        const key = `${c.source}:${c.id}`;
        if (unique.has(key)) continue;
        unique.set(key, c);
    }

    const rows = Array.from(unique.values()).slice(0, 24);
    if (rows.length === 0) {
        return;
    }

    await ModelAgentCitation.insertMany(
        rows.map((c, orderIndex) => ({
            agentFinalId: finalDoc._id,
            chatMessageId,
            agentInstanceId,
            userId,
            threadId,
            source: String(c.source).slice(0, 64),
            sourceRecordId: String(c.id).slice(0, 64),
            title: String(c.title || '').slice(0, 200),
            summary: String(c.summary || '').slice(0, 400),
            orderIndex,
            createdAtUtc: new Date(),
            updatedAtUtc: new Date(),
        }))
    );
};

/** Shape expected by the client (legacy agentFinalArtifactV1). */
export type AgentFinalArtifactClientShape = {
    version: number;
    kind: 'agent_final';
    citations: Array<{
        source: string;
        id: string;
        title: string;
        summary: string;
    }>;
    researchBrief: string;
    confidence: 'low' | 'medium' | 'high';
};

/** Attach normalized finals onto chat docs as agentFinalArtifactV1 for the client. */
export const attachAgentFinalsToChatDocs = async (
    chatDocs: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> => {
    if (!chatDocs.length) return chatDocs;

    const messageIds = chatDocs
        .map((d) => d._id)
        .filter((id): id is mongoose.Types.ObjectId => Boolean(id));

    if (messageIds.length === 0) return chatDocs;

    const finals = await ModelAgentFinal.find({
        chatMessageId: { $in: messageIds },
    }).lean();

    if (finals.length === 0) {
        return chatDocs.map((d) => {
            const { agentFinalArtifactV1: _drop, ...rest } = d;
            return rest;
        });
    }

    const finalIds = finals.map((f) => f._id);
    const citations = await ModelAgentCitation.find({
        agentFinalId: { $in: finalIds },
    })
        .sort({ orderIndex: 1 })
        .lean();

    const citationsByFinal = new Map<string, typeof citations>();
    for (const c of citations) {
        const key = String(c.agentFinalId);
        const list = citationsByFinal.get(key) || [];
        list.push(c);
        citationsByFinal.set(key, list);
    }

    const artifactByMessage = new Map<string, AgentFinalArtifactClientShape>();
    for (const f of finals) {
        const list = citationsByFinal.get(String(f._id)) || [];
        artifactByMessage.set(String(f.chatMessageId), {
            version: f.version || 1,
            kind: 'agent_final',
            researchBrief: f.researchBrief || '',
            confidence: (f.confidence as 'low' | 'medium' | 'high') || 'low',
            citations: list.map((c) => ({
                source: c.source,
                id: c.sourceRecordId,
                title: c.title || '',
                summary: c.summary || '',
            })),
        });
    }

    return chatDocs.map((d) => {
        const { agentFinalArtifactV1: _legacy, ...rest } = d;
        const artifact = artifactByMessage.get(String(d._id));
        if (!artifact) return rest;
        return { ...rest, agentFinalArtifactV1: artifact };
    });
};
