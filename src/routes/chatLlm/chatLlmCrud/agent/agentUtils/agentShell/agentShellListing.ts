/**
 * Normalize Shell Engine file/list rows for agent context.
 * Keep agent workspace uploads + generated outputs only; drop junk; newest first; cap at 100.
 */

export const AGENT_SHELL_CONTEXT_FILE_LIMIT = 100;

/** Paths that must never enter agent LLM context (deps, VCS, caches). */
export const isIgnoredAgentShellPath = (relativePath: string): boolean => {
    const rel = String(relativePath || '').replace(/\\/g, '/');
    if (!rel) return true;
    return (
        /(^|\/)(node_modules|\.git|venv|\.agent_venv|site-packages|__pycache__|\.dist-info)(\/|$)/i.test(
            rel
        ) ||
        /\/venv[_/]/i.test(rel) ||
        /package-lock\.json$/i.test(rel) ||
        /\.pyc$/i.test(rel)
    );
};

export type AgentShellListEntry = {
    relativePath: string;
    pathInAgentFolder: string;
    absolutePath: string;
    isDir: boolean;
    size: number;
    mtimeMs: number;
};

const pathInAgentFolderFrom = (rel: string, agentShellDir: string): string => {
    const folderIdx = rel.indexOf(`${agentShellDir}/`);
    return folderIdx !== -1 ? rel.slice(folderIdx + agentShellDir.length + 1) : rel;
};

/**
 * Parse raw shell-engine list rows → filtered, mtime-sorted, limited entries.
 * Includes both files and directories (agent-generated or uploaded under the agent folder).
 */
export const normalizeAgentShellListing = (params: {
    rawFiles: unknown;
    agentShellDir: string;
    limit?: number;
}): AgentShellListEntry[] => {
    const agentShellDir = String(params.agentShellDir || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const limit = Math.max(1, Math.min(params.limit ?? AGENT_SHELL_CONTEXT_FILE_LIMIT, 500));
    const raw = Array.isArray(params.rawFiles) ? params.rawFiles : [];

    const byPath = new Map<string, AgentShellListEntry>();

    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        const rel = typeof o.relativePath === 'string' ? o.relativePath.replace(/\\/g, '/') : '';
        if (!rel || isIgnoredAgentShellPath(rel)) continue;
        // Only agent workspace paths (uploads + generated scripts/outputs).
        if (agentShellDir && !rel.includes(agentShellDir) && !rel.startsWith('agent/')) {
            // Still allow pathInAgentFolder-style rows that are already relative
            if (rel.includes('ai-notes-xyz-shell-files/') && !rel.includes('/agent/')) continue;
        }

        const abs =
            typeof o.absolutePath === 'string' && o.absolutePath.trim()
                ? o.absolutePath.replace(/\\/g, '/')
                : `/app/data/${rel}`;
        const pathInAgentFolder = pathInAgentFolderFrom(rel, agentShellDir);
        if (!pathInAgentFolder || isIgnoredAgentShellPath(pathInAgentFolder)) continue;

        const mtimeMs = typeof o.mtimeMs === 'number' && Number.isFinite(o.mtimeMs) ? o.mtimeMs : 0;
        const size = typeof o.size === 'number' && Number.isFinite(o.size) ? o.size : 0;
        const isDir = Boolean(o.isDir);
        const key = pathInAgentFolder.toLowerCase();
        const prev = byPath.get(key);
        if (!prev || mtimeMs >= prev.mtimeMs) {
            byPath.set(key, {
                relativePath: rel,
                pathInAgentFolder,
                absolutePath: abs,
                isDir,
                size,
                mtimeMs,
            });
        }

        // Ensure parent folders appear in context (newest child mtime).
        const parts = pathInAgentFolder.split('/').filter(Boolean);
        if (parts.length > 1) {
            let acc = '';
            for (let i = 0; i < parts.length - 1; i++) {
                acc = acc ? `${acc}/${parts[i]}` : parts[i];
                if (isIgnoredAgentShellPath(acc)) break;
                const folderKey = acc.toLowerCase();
                const folderRel = `${agentShellDir}/${acc}`;
                const existing = byPath.get(folderKey);
                if (!existing) {
                    byPath.set(folderKey, {
                        relativePath: folderRel,
                        pathInAgentFolder: acc,
                        absolutePath: `/app/data/${folderRel}`,
                        isDir: true,
                        size: 0,
                        mtimeMs,
                    });
                } else if (mtimeMs > existing.mtimeMs) {
                    existing.mtimeMs = mtimeMs;
                }
            }
        }
    }

    return [...byPath.values()]
        .sort((a, b) => {
            if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
            return a.pathInAgentFolder.localeCompare(b.pathInAgentFolder);
        })
        .slice(0, limit);
};

/** Compact text block for planner / script-gen prompts. */
export const formatAgentShellListingForContext = (
    entries: AgentShellListEntry[],
    opts?: { maxChars?: number }
): string => {
    if (!entries.length) return '(no agent workspace files yet)';
    const maxChars = opts?.maxChars ?? 6000;
    const lines = entries.map((e) => {
        const kind = e.isDir ? 'dir' : 'file';
        const mtime = e.mtimeMs > 0 ? new Date(e.mtimeMs).toISOString() : 'unknown';
        return `- [${kind}] ${e.pathInAgentFolder} | ${e.absolutePath} | ${e.size}b | mtime=${mtime}`;
    });
    let out = `Workspace entries (newest first, max ${AGENT_SHELL_CONTEXT_FILE_LIMIT}):\n${lines.join('\n')}`;
    if (out.length > maxChars) {
        out = `${out.slice(0, maxChars)}\n…(truncated)`;
    }
    return out;
};
