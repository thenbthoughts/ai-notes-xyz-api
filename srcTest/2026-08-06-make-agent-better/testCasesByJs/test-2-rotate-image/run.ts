import path from 'path';
import {
    connectDb,
    disconnectDb,
    runAgentUseCase,
    writeReport,
} from '../lib/agentTestHarness';

const REPORT_DIR = path.join(__dirname, 'reports');
const FIXTURE = path.resolve(
    __dirname,
    '../../test-2-rotate-image/img-test-2-rotate-image.png'
);

const main = async () => {
    await connectDb();
    try {
        const result = await runAgentUseCase({
            slug: 'test-2-rotate-image',
            title: 'Rotate image',
            prompt:
                'Rotate the input image by 90 degrees clockwise and save the result as a new image file ' +
                'in the agent workspace (e.g. rotated.png). Print absolute path and size. ' +
                'Stop once the output image exists — no endless re-verification.',
            fixtureUpload: {
                localPath: FIXTURE,
                destFileName: 'img-test-2-rotate-image.png',
                mimeType: 'image/png',
            },
            assert: async (ctx) => {
                const outs = ctx.deliverables.filter(
                    (d) =>
                        /\.(png|jpe?g|webp)$/i.test(d.relativePath) &&
                        !/(^|\/)uploads\//i.test(d.pathInAgentFolder) &&
                        !/img-test-2-rotate-image\.png$/i.test(d.pathInAgentFolder)
                );
                return [
                    {
                        name: 'rotated_output_file',
                        ok: outs.length >= 1 && outs.some((o) => o.size > 0),
                        detail: outs.map((o) => `${o.pathInAgentFolder} (${o.size}b)`).join(', ') || 'missing',
                    },
                ];
            },
        });
        writeReport(REPORT_DIR, {
            slug: 'test-2-rotate-image',
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

// npx ts-node -r dotenv/config ./srcTest/2026-08-06-make-agent-better/testCasesByJs/test-2-rotate-image/run.ts
