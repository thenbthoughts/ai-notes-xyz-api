import path from 'path';
import {
    assertHasDeliverableExt,
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
            slug: 'test-1-create-a-pdf-with-datetime',
            title: 'Create PDF with datetime',
            prompt:
                'Generate a PDF file that includes the current date and time in India (Asia/Kolkata). ' +
                'Save it in the agent workspace. Print the absolute path and file size when done. ' +
                'Do not keep verifying after the PDF exists.',
            assert: async (ctx) => [assertHasDeliverableExt(ctx, /\.pdf$/i, 'pdf')],
        });
        writeReport(REPORT_DIR, {
            slug: 'test-1-create-a-pdf-with-datetime',
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

// npx ts-node -r dotenv/config ./srcTest/2026-08-06-make-agent-better/testCasesByJs/test-1-create-a-pdf-with-datetime/run.ts
