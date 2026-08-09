/**
 * Run all agent use-case scratchpad tests sequentially.
 *
 *   npx ts-node -r dotenv/config ./srcTest/2026-08-06-make-agent-better/testCasesByJs/run-all.ts
 *
 * Optional:
 *   AGENT_TEST_USER_ID=...
 *   AGENT_TEST_ONLY=test-4-generate-a-excel-with-100-password
 */
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const ROOT = __dirname;

const CASES = [
    'test-1-create-a-pdf-with-datetime',
    'test-2-rotate-image',
    'test-3-resize-image',
    'test-4-generate-a-excel-with-100-password',
    'test-5-ask-how-to-improve-my-life',
];

const runOne = (slug: string): Promise<{ slug: string; code: number }> =>
    new Promise((resolve) => {
        const script = path.join(ROOT, slug, 'run.ts');
        if (!fs.existsSync(script)) {
            console.error(`Missing ${script}`);
            resolve({ slug, code: 1 });
            return;
        }
        console.log(`\n######## RUNNING ${slug} ########\n`);
        const child = spawn(
            process.platform === 'win32' ? 'npx.cmd' : 'npx',
            ['ts-node', '-r', 'dotenv/config', script],
            {
                cwd: path.resolve(ROOT, '../../..'),
                stdio: 'inherit',
                shell: true,
                env: process.env,
            }
        );
        child.on('close', (code) => resolve({ slug, code: code ?? 1 }));
    });

const main = async () => {
    const only = process.env.AGENT_TEST_ONLY?.trim();
    const list = only ? CASES.filter((c) => c === only) : CASES;
    if (list.length === 0) {
        console.error(`No cases matched AGENT_TEST_ONLY=${only}`);
        process.exit(1);
    }

    const results: Array<{ slug: string; code: number }> = [];
    for (const slug of list) {
        results.push(await runOne(slug));
    }

    console.log('\n======== SUMMARY ========');
    for (const r of results) {
        console.log(`${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.slug}`);
    }
    const failed = results.filter((r) => r.code !== 0);
    process.exit(failed.length ? 1 : 0);
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
