import path from 'path';

/**
 * Parse one validated shell line into `spawn(cmd, args, { shell: false })` form.
 * Bash-like rules: whitespace splits tokens; single-quoted runs are literal;
 * double-quoted runs allow \\ and \\". Matches planner quoting for URLs (`&` inside '...').
 */
export function shellLineToSpawnArgv(
    line: string,
): { ok: true; cmd: string; args: string[] } | { ok: false; reason: string } {
    const s = line.trim();
    if (!s) {
        return { ok: false, reason: 'empty line' };
    }

    const tokens: string[] = [];
    let i = 0;

    while (i < s.length) {
        while (i < s.length && /\s/.test(s[i])) {
            i += 1;
        }
        if (i >= s.length) {
            break;
        }

        let arg = '';

        if (s[i] === "'") {
            i += 1;
            while (i < s.length && s[i] !== "'") {
                arg += s[i];
                i += 1;
            }
            if (i >= s.length) {
                return { ok: false, reason: 'unbalanced single quote' };
            }
            i += 1;
            tokens.push(arg);
            continue;
        }

        if (s[i] === '"') {
            i += 1;
            let escape = false;
            let closed = false;
            while (i < s.length) {
                if (escape) {
                    arg += s[i];
                    escape = false;
                    i += 1;
                    continue;
                }
                if (s[i] === '\\') {
                    escape = true;
                    i += 1;
                    continue;
                }
                if (s[i] === '"') {
                    i += 1;
                    closed = true;
                    break;
                }
                arg += s[i];
                i += 1;
            }
            if (escape) {
                return { ok: false, reason: 'unfinished escape in double-quoted segment' };
            }
            if (!closed) {
                return { ok: false, reason: 'unbalanced double quote' };
            }
            tokens.push(arg);
            continue;
        }

        while (i < s.length && !/\s/.test(s[i])) {
            arg += s[i];
            i += 1;
        }
        tokens.push(arg);
    }

    if (tokens.length === 0) {
        return { ok: false, reason: 'no tokens' };
    }

    const [cmd, ...args] = tokens;
    if (!cmd.length) {
        return { ok: false, reason: 'empty command' };
    }

    return { ok: true, cmd, args };
}

/** Basename of program token (for logs). */
export function spawnProgramBasename(cmd: string): string {
    const n = cmd.replace(/\\/g, '/');
    return path.posix.basename(n);
}
