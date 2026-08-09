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
            slug: 'test-4-generate-a-excel-with-100-password',
            title: 'Generate Excel with 100 passwords',
            prompt:
                'Generate an Excel spreadsheet (.xlsx) containing 100 randomly generated unique passwords. ' +
                'Save it in the agent workspace (e.g. passwords.xlsx). Print absolute path and size. ' +
                'Once the .xlsx file exists, finish immediately — do not loop on pandas verification or venv installs.',
            assert: async (ctx) => {
                const checks = [assertHasDeliverableExt(ctx, /\.xlsx$/i, 'xlsx')];
                const xlsx = ctx.deliverables.find((d) => /\.xlsx$/i.test(d.relativePath) && d.size > 0);
                checks.push({
                    name: 'xlsx_nontrivial_size',
                    ok: Boolean(xlsx && xlsx.size >= 1000),
                    detail: xlsx ? `${xlsx.size}b` : 'missing',
                });
                return checks;
            },
        });
        writeReport(REPORT_DIR, {
            slug: 'test-4-generate-a-excel-with-100-password',
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

// npx ts-node -r dotenv/config ./srcTest/2026-08-06-make-agent-better/testCasesByJs/test-4-generate-a-excel-with-100-password/run.ts
