/**
 * Lightweight sanity checks for AM4 shell path helpers (no network).
 * Run: npx ts-node --transpile-only scripts/verifyAm4FileTransferPaths.ts
 */
import assert from 'node:assert/strict';

import {
    assertSafeAm4ShellRelativePath,
    buildAm4CanonicalShellPaths,
    extractAm4OutputCandidateFilenames,
    AM4_SHELL_ROOT_PREFIX,
} from '../src/routes/chatLlm/chatLlmCrud/answerMachineV4/am4CanonicalPaths';

const sampleUserObjectId = '507f1f77bcf86cd799439011';
const sampleThreadId = '507f191e810c19729de860ea';

const canonicalPaths = buildAm4CanonicalShellPaths({
    userObjectId: sampleUserObjectId,
    threadId: sampleThreadId,
});

const inputRelativePath = canonicalPaths.inputFileRelativePath('my-screenshot.png');
assert.match(inputRelativePath, new RegExp(sampleUserObjectId));
assert.match(inputRelativePath, new RegExp(sampleThreadId));
assert(inputRelativePath.includes('/my-screenshot.png'), inputRelativePath);

const outputRelativePath = canonicalPaths.outputFileRelativePath('out.csv');
assert(outputRelativePath.includes('/outputfile/out.csv'), outputRelativePath);

assert.match(canonicalPaths.workDirectoryMarkerRelativePath, /workdirectory\/\.am4-workspace-marker$/);

assertSafeAm4ShellRelativePath(inputRelativePath);
assert.throws(() => assertSafeAm4ShellRelativePath('no-prefix/file.txt'));
assert.throws(() => assertSafeAm4ShellRelativePath('ai-notes-xyz-shell-files/../../../etc/passwd'));

const extractedNames = extractAm4OutputCandidateFilenames(
    'Done — saved ai-notes_screenshot.png and also report.PDF in /tmp',
);
assert.ok(extractedNames.includes('ai-notes_screenshot.png'));
assert.ok(extractedNames.some((n) => n.toLowerCase() === 'report.pdf'));

assert.equal(AM4_SHELL_ROOT_PREFIX, 'ai-notes-xyz-shell-files');

// eslint-disable-next-line no-console
console.log('verifyAm4FileTransferPaths: all checks passed');
