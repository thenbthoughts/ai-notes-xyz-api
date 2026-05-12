import axios from 'axios';
import mongoose from 'mongoose';

import type { S3Config } from '../../../utils/upload/uploadFunc';
import {
    recordAnswerMachineFileArtifact,
    type RecordAnswerMachineFileArtifactResult,
} from './answerMachineFileService';

type WorkspaceFileRow = { relativePath: string; size: number; mtimeMs: number };

const IMPORT_CAP_BYTES = 45 * 1024 * 1024;

export type ImportAnswerMachineShellOutputsParams = {
    apiBase: string;
    token: string;
    threadId: mongoose.Types.ObjectId;
    username: string;
    threadWorkspaceRelativeDir: string;

    stdout: string;
    stderr: string;

    /** Paths seeded into the workspace (user uploads); excluded from auto-import unless stdout references them explicitly. */
    workspaceSkipPaths: Set<string>;

    /** Snapshot of workspace mtimes captured immediately before executing the shell command. */
    preExecuteMtimes: Map<string, number>;

    storageType: 's3' | 'gridfs';
    s3Config: S3Config | undefined;

    answerMachineRequestV3Id: mongoose.Types.ObjectId;
    answerMachineIteration?: number | null;
    answerMachineSubQuestionV3Id?: mongoose.Types.ObjectId | null;
};

export type ImportAnswerMachineShellOutputsResult = {
    imported: RecordAnswerMachineFileArtifactResult[];
    /** Short lines appended to sub-question shell summaries for operators. */
    summaryAppendix: string;
};

/**
 * After a single Answer Machine shell command finishes, scans the thread workspace for new/changed files,
 * imports matching binaries into app storage, and records rows in `answerMachineFilesV3`. Mirrors the discovery
 * strategy used by chat shell todo imports (stdout path mentions + directory listing deltas vs skip-set inputs).
 */
export async function importAnswerMachineOutputsAfterShellExecute(
    params: ImportAnswerMachineShellOutputsParams,
): Promise<ImportAnswerMachineShellOutputsResult> {
    const imported: RecordAnswerMachineFileArtifactResult[] = [];
    const appendixLines: string[] = [];

    const listingAfterShell = await axios
        .get(`${params.apiBase}/shell-engine/file/list`, {
            params: { relativeDir: params.threadWorkspaceRelativeDir, maxFiles: 400 },
            timeout: 60_000,
            headers: { 'X-API-Token': params.token },
            validateStatus: () => true,
        })
        .then((res) => {
            if (res.status !== 200 || !res.data || typeof res.data !== 'object') {
                return [] as WorkspaceFileRow[];
            }
            const body = res.data as { files?: unknown };
            if (!Array.isArray(body.files)) {
                return [] as WorkspaceFileRow[];
            }
            const rows: WorkspaceFileRow[] = [];
            for (const row of body.files) {
                if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
                const o = row as Record<string, unknown>;
                const rp = typeof o.relativePath === 'string' ? o.relativePath.replace(/\\/g, '/') : '';
                if (!rp) continue;
                const size = typeof o.size === 'number' ? o.size : 0;
                const mtimeMs = typeof o.mtimeMs === 'number' ? o.mtimeMs : 0;
                rows.push({ relativePath: rp, size, mtimeMs });
            }
            return rows;
        })
        .catch(() => [] as WorkspaceFileRow[]);

    const mentionedPaths = new Set<string>();
    const blob = `${params.stdout}\n${params.stderr}`;
    const re = /[^\s"'<>]+ai-notes-xyz-shell-files[^\s"'<>]+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(blob)) !== null) {
        let p = m[0].replace(/^[`"'(,]+|[\)`"',.;:]+$/g, '');
        p = p.replace(/\\/g, '/');
        if (!p.includes('..')) {
            mentionedPaths.add(p);
        }
    }

    /** Bare filenames in logs (e.g. `page.png`) — map to workspace listing paths so imports work without full path. */
    const bareFileRe = /\b([A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|jpe?g|gif|webp|pdf|html|htm|csv|txt|json))\b/gi;
    const bareLower = new Set<string>();
    let bm: RegExpExecArray | null;
    while ((bm = bareFileRe.exec(blob)) !== null) {
        bareLower.add(bm[1].toLowerCase());
    }
    for (const f of listingAfterShell) {
        const rel = f.relativePath.replace(/\\/g, '/');
        const base = rel.split('/').pop()?.toLowerCase() || '';
        if (base && bareLower.has(base)) {
            mentionedPaths.add(rel);
        }
    }

    const newerOutputs: string[] = [];
    for (const f of listingAfterShell) {
        const rel = f.relativePath.replace(/\\/g, '/');
        if (params.workspaceSkipPaths.has(rel)) {
            continue;
        }
        const prev = params.preExecuteMtimes.get(rel);
        if (prev === undefined || f.mtimeMs > prev) {
            newerOutputs.push(rel);
        }
    }

    const candidatePaths = [...new Set([...mentionedPaths, ...newerOutputs])];

    for (const normalized of candidatePaths) {
        if (!normalized || normalized.includes('..')) {
            continue;
        }
        if (params.workspaceSkipPaths.has(normalized)) {
            continue;
        }

        const fileRes = await axios.get(`${params.apiBase}/shell-engine/file/read`, {
            params: { relativePath: normalized },
            responseType: 'arraybuffer',
            timeout: 60_000,
            headers: { 'X-API-Token': params.token },
            validateStatus: () => true,
        });

        if (fileRes.status !== 200 || !fileRes.data) {
            continue;
        }

        const buf = Buffer.from(fileRes.data as ArrayBuffer);
        if (buf.length === 0 || buf.length > IMPORT_CAP_BYTES) {
            continue;
        }

        const ct =
            (typeof fileRes.headers['content-type'] === 'string'
                ? fileRes.headers['content-type']
                : 'application/octet-stream') || 'application/octet-stream';

        const recorded = await recordAnswerMachineFileArtifact({
            username: params.username,
            threadId: params.threadId,
            answerMachineRequestV3Id: params.answerMachineRequestV3Id,
            answerMachineIteration: params.answerMachineIteration ?? null,
            answerMachineSubQuestionV3Id: params.answerMachineSubQuestionV3Id ?? null,
            fileType: 'generated',
            purpose: 'shell_generated',
            description: `Imported from workspace path ${normalized}`,
            metadata: { shellWorkspacePath: normalized },
            relativeShellPath: normalized,
            fileBuffer: buf,
            contentType: ct,
            suggestedBaseName: normalized.split('/').pop() || 'artifact.bin',
            storageType: params.storageType,
            s3Config: params.s3Config,
        });

        imported.push(recorded);
        if (recorded.ok) {
            appendixLines.push(
                `- Artifact recorded (${normalized}) → storage key \`${recorded.storedFileUrl}\` (Answer Machine Files V3 id ${recorded.id}).`,
            );
        }
    }

    const summaryAppendix =
        appendixLines.length > 0
            ? ['### Imported artifacts (Answer Machine Files V3)', ...appendixLines].join('\n')
            : '';

    return { imported, summaryAppendix };
}
