import path from 'path';
import {
    connectDb,
    disconnectDb,
    runAgentUseCase,
    writeReport,
} from '../lib/agentTestHarness';

const REPORT_DIR = path.join(__dirname, 'reports');

const main = async () => {
    await connectDb();
    try {
        const result = await runAgentUseCase({
            slug: 'test-5-ask-how-to-improve-my-life',
            title: 'How to improve my life',
            personalContext: true,
            prompt:
                'How to improve my life? Use my personal notes/tasks/life events when available. ' +
                'Give concrete, structured advice. When you have a solid answer, finish — do not keep searching forever.',
            assert: async (ctx) => {
                const finals = ctx.finalMessages.filter(
                    (m) =>
                        m.tags.includes('finalize') &&
                        m.tags.includes('agent_success') &&
                        m.content.trim().length > 80
                );
                return [
                    {
                        name: 'finalize_substantial',
                        ok: finals.length >= 1,
                        detail: finals[0]
                            ? `len=${finals[0].content.length}`
                            : 'no substantial final',
                    },
                ];
            },
        });
        writeReport(REPORT_DIR, {
            slug: 'test-5-ask-how-to-improve-my-life',
            ...result,
            threadId: result.ctx ? String(result.ctx.threadId) : null,
            agentInstanceId: result.ctx ? String(result.ctx.agentInstanceId) : null,
            threadTitle: result.ctx?.threadTitle,
        });
        process.exitCode = result.ok ? 0 : 1;
    } finally {
        await disconnectDb();
    }
};

main().catch(async (err) => {
    console.error(err);
    try {
        await disconnectDb();
    } catch {
        /* ignore */
    }
    process.exit(1);
});

// npx ts-node -r dotenv/config ./srcTest/2026-08-06-make-agent-better/testCasesByJs/test-5-ask-how-to-improve-my-life/run.ts
