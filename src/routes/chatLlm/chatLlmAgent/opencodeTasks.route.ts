import mongoose from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import { getMongodbObjectOrNull } from '../../../utils/common/getMongodbObjectOrNull';
import { ModelChatLlmOpencodeTask } from '../../../schema/schemaChatLlm/SchemaChatLlmOpencodeTask.schema';
import { ModelChatLlmThreadOpencodeSession } from '../../../schema/schemaChatLlm/SchemaChatLlmThreadOpencodeSession.schema';

const router = Router();

router.post('/list', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const auth_username = res.locals.auth_username;
        const threadId = getMongodbObjectOrNull(req.body.threadId);
        if (threadId === null) {
            return res.status(400).json({ message: 'Thread ID cannot be null' });
        }

        const answerMachineRecordId = getMongodbObjectOrNull(req.body.answerMachineRecordId);

        const match: Record<string, unknown> = {
            threadId,
            username: auth_username,
        };
        if (answerMachineRecordId) {
            match.answerMachineRecordId = answerMachineRecordId;
        }

        const limitRaw = typeof req.body.limit === 'number' ? req.body.limit : 50;
        const limit = Math.max(1, Math.min(200, limitRaw));

        const [tasks, threadSession] = await Promise.all([
            ModelChatLlmOpencodeTask.find(match)
                .sort({ createdAtUtc: -1, sortIndex: 1 })
                .limit(limit)
                .lean(),
            ModelChatLlmThreadOpencodeSession.findOne({ threadId, username: auth_username })
                .select({ sdkSessionId: 1 })
                .lean(),
        ]);

        const sdkSessionId =
            threadSession && typeof (threadSession as { sdkSessionId?: string }).sdkSessionId === 'string'
                ? (threadSession as { sdkSessionId: string }).sdkSessionId.trim()
                : '';

        return res.status(200).json({
            threadId: threadId.toString(),
            answerMachineRecordId: answerMachineRecordId ? answerMachineRecordId.toString() : null,
            sdkSessionId,
            tasks: tasks.map((t: any) => {
                const rs = t?.runStartedAtUtc;
                const rf = t?.runFinishedAtUtc;
                let executionDurationMs: number | null = null;
                if (rs != null && rf != null) {
                    const a = new Date(rs).getTime();
                    const b = new Date(rf).getTime();
                    if (Number.isFinite(a) && Number.isFinite(b) && b >= a) {
                        executionDurationMs = b - a;
                    }
                }
                return {
                    id: String(t?._id || ''),
                    sortIndex: typeof t?.sortIndex === 'number' ? t.sortIndex : 0,
                    title: typeof t?.title === 'string' ? t.title : '',
                    instruction: typeof t?.instruction === 'string' ? t.instruction : '',
                    status: typeof t?.status === 'string' ? t.status : 'pending',
                    summary: typeof t?.summary === 'string' ? t.summary : '',
                    errorReason: typeof t?.errorReason === 'string' ? t.errorReason : '',
                    agentTranscript:
                        typeof t?.agentTranscript === 'string' ? t.agentTranscript : '',
                    inputFileRefs: Array.isArray(t?.inputFileRefs) ? t.inputFileRefs : [],
                    outputFileRefs: Array.isArray(t?.outputFileRefs) ? t.outputFileRefs : [],
                    createdAtUtc: t?.createdAtUtc,
                    updatedAtUtc: t?.updatedAtUtc,
                    runStartedAtUtc: rs ?? null,
                    runFinishedAtUtc: rf ?? null,
                    executionDurationMs,
                };
            }),
        });
    } catch (error) {
        console.error('Error listing OpenCode tasks:', error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;

