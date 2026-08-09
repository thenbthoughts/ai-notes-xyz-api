/**
 * Run one use-case from ../use-cases/task-* by slug.
 *
 *   npx ts-node -r dotenv/config ./srcTest/2026-08-06-make-agent-better/testCasesByJs/run-task.ts task-006-write-hello-world-file
 *   npx ts-node -r dotenv/config ./srcTest/2026-08-06-make-agent-better/testCasesByJs/run-task.ts task-001
 */
import path from 'path';
import {
    assertHasDeliverableExt,
    assertWorkspacePath,
    connectDb,
    disconnectDb,
    runAgentUseCase,
    writeReport,
    type CheckResult,
    type AgentRunContext,
} from './lib/agentTestHarness';
import { parseUseCase } from './lib/parseUseCase';

const slugArg = process.argv[2] || process.env.AGENT_TEST_ONLY || '';
if (!slugArg.trim()) {
    console.error('Usage: run-task.ts <task-slug>');
    process.exit(1);
}

const inferAssertions = (slug: string, ctx: AgentRunContext): CheckResult[] => {
    const checks: CheckResult[] = [];
    if (/pdf|datetime|ist/i.test(slug)) {
        checks.push(assertHasDeliverableExt(ctx, /\.pdf$/i, 'pdf'));
    }
    if (/excel|password|xlsx/i.test(slug) && /excel|password/i.test(slug)) {
        checks.push(assertHasDeliverableExt(ctx, /\.xlsx$/i, 'xlsx'));
    }
    if (/rotate|resize|grayscale|compress|image|screenshot|contact|watermark|pipeline/i.test(slug)) {
        checks.push(
            assertWorkspacePath(
                ctx,
                /\.(png|jpe?g|webp)$/i,
                'image_out'
            )
        );
        // Prefer an output not only under uploads/
        const outs = ctx.shellListing.filter(
            (f) =>
                !f.isDir &&
                /\.(png|jpe?g|webp)$/i.test(f.relativePath) &&
                !/(^|\/)uploads\//i.test(f.pathInAgentFolder || f.relativePath)
        );
        if (/rotate|resize|grayscale|compress|pipeline|watermark/i.test(slug)) {
            checks.push({
                name: 'image_output_outside_uploads',
                ok: outs.some(
                    (o) =>
                        !/img-test-\d-/i.test(o.pathInAgentFolder || '') ||
                        /(_rotated|_resized|rotated|resized|gray|compress|out)/i.test(
                            o.pathInAgentFolder || ''
                        )
                ),
                detail:
                    outs
                        .filter(
                            (o) =>
                                !/img-test-\d-/i.test(o.pathInAgentFolder || '') ||
                                /(_rotated|_resized|rotated|resized|gray|compress|out)/i.test(
                                    o.pathInAgentFolder || ''
                                )
                        )
                        .map((o) => o.pathInAgentFolder)
                        .join(', ') || 'only source fixture or none',
            });
        }
    }
    if (/hello-world-file|hello_txt|create-hello/i.test(slug) || /write-hello-world/i.test(slug)) {
        checks.push(assertWorkspacePath(ctx, /(^|\/)hello\.txt$/i, 'hello_txt'));
    }
    if (/draft-email/i.test(slug)) {
        checks.push(assertWorkspacePath(ctx, /kickoff-invite-draft\.md$/i, 'email_draft'));
    }
    if (/git-clone/i.test(slug)) {
        const hasReadme = ctx.shellListing.some(
            (f) =>
                !f.isDir &&
                /hello-world/i.test(f.relativePath) &&
                /readme(\.md|\.txt)?$/i.test(f.pathInAgentFolder || f.relativePath)
        );
        const hasGit = ctx.shellListing.some(
            (f) => /hello-world\/\.git\/HEAD$/i.test(f.relativePath.replace(/\\/g, '/'))
        );
        checks.push({
            name: 'hello_world_clone',
            ok: hasGit && hasReadme,
            detail: hasGit && hasReadme ? 'Hello-World/.git + README' : `git=${hasGit} readme=${hasReadme}`,
        });
    }
    if (/improve-my-life|personal-data|life-improvement|life-goals/i.test(slug)) {
        const finals = ctx.finalMessages.filter(
            (m) =>
                m.tags.includes('finalize') &&
                m.tags.includes('agent_success') &&
                m.content.trim().length > 80
        );
        checks.push({
            name: 'finalize_substantial',
            ok: finals.length >= 1,
            detail: finals[0] ? `len=${finals[0].content.length}` : 'no substantial final',
        });
    }
    if (/create-file-then-list|write-today-date|create-empty-notes/i.test(slug)) {
        checks.push({
            name: 'any_workspace_file',
            ok: ctx.shellListing.some((f) => !f.isDir && f.size > 0),
            detail: `files=${ctx.shellListing.filter((f) => !f.isDir).length}`,
        });
    }
    return checks;
};

const main = async () => {
    const parsed = parseUseCase(slugArg.trim());
    const reportDir = path.join(
        path.resolve(__dirname, '../use-cases', parsed.slug),
        'reports'
    );

    await connectDb();
    try {
        const result = await runAgentUseCase({
            slug: parsed.slug,
            title: parsed.title,
            prompt: parsed.prompt,
            personalContext: parsed.personalContext,
            fixtureUploads: parsed.fixtures,
            assert: async (ctx) => inferAssertions(parsed.slug, ctx),
        });
        writeReport(reportDir, {
            slug: parsed.slug,
            title: parsed.title,
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
