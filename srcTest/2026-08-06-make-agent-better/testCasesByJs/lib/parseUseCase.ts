/**
 * Parse use-case task.md + discover fixtures under ../use-cases/task-*/
import fs from 'fs';
import path from 'path';

export type ParsedUseCase = {
    slug: string;
    title: string;
    tool: string;
    task: string;
    constraints: string;
    doneWhen: string;
    notes: string;
    /** Full prompt for the agent */
    prompt: string;
    personalContext: boolean;
    /** Files/dirs to upload (relative to use-case folder → workspace-relative dest) */
    fixtures: Array<{ localPath: string; destRelativePath: string; mimeType?: string }>;
};

const USE_CASES_ROOT = path.resolve(__dirname, '../../use-cases');

const guessMime = (fileName: string): string => {
    const ext = path.extname(fileName).toLowerCase();
    const map: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.pdf': 'application/pdf',
        '.json': 'application/json',
        '.csv': 'text/csv',
        '.html': 'text/html',
        '.md': 'text/markdown',
        '.txt': 'text/plain',
        '.js': 'application/javascript',
        '.py': 'text/x-python',
        '.yaml': 'text/yaml',
        '.yml': 'text/yaml',
        '.xml': 'application/xml',
        '.log': 'text/plain',
    };
    return map[ext] || 'application/octet-stream';
};

const section = (md: string, heading: string): string => {
    const re = new RegExp(`## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, 'i');
    const m = md.match(re);
    return m ? m[1].trim() : '';
};

const listFilesRecursive = (dir: string, base = dir): string[] => {
    const out: string[] = [];
    if (!fs.existsSync(dir)) return out;
    for (const name of fs.readdirSync(dir)) {
        if (name === 'task.md' || name === 'reports' || name.startsWith('test-')) continue;
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) {
            out.push(...listFilesRecursive(full, base));
        } else if (st.isFile()) {
            out.push(path.relative(base, full).split(path.sep).join('/'));
        }
    }
    return out;
};

export const resolveUseCaseDir = (slug: string): string => {
    const direct = path.join(USE_CASES_ROOT, slug);
    if (fs.existsSync(path.join(direct, 'task.md'))) return direct;
    // allow bare number or partial
    const entries = fs.readdirSync(USE_CASES_ROOT).filter((d) => d.startsWith(slug) || d === slug);
    if (entries.length === 1) {
        return path.join(USE_CASES_ROOT, entries[0]);
    }
    throw new Error(`Use-case not found: ${slug} under ${USE_CASES_ROOT}`);
};

export const listUseCaseSlugs = (): string[] =>
    fs
        .readdirSync(USE_CASES_ROOT)
        .filter((d) => d.startsWith('task-') && fs.existsSync(path.join(USE_CASES_ROOT, d, 'task.md')))
        .sort();

export const parseUseCase = (slugOrDir: string): ParsedUseCase => {
    const dir = path.isAbsolute(slugOrDir)
        ? slugOrDir
        : resolveUseCaseDir(slugOrDir);
    const slug = path.basename(dir);
    const md = fs.readFileSync(path.join(dir, 'task.md'), 'utf8');

    const titleLine = (md.match(/^#\s+(.+)$/m) || [, slug])[1].trim();
    const title = titleLine.replace(/^\d+\.\s*/, '');
    const toolMatch = md.match(/\*\*Tool:\*\*\s*`?([^`\n]+)`?/i);
    const tool = (toolMatch?.[1] || 'shell').trim();
    const task = section(md, 'Task');
    const constraints = section(md, 'Constraints');
    const doneWhen = section(md, 'Done when');
    const notes = section(md, 'Notes');

    const personalContext =
        /personal|life|notes\/tasks|search-in-db|search_all_domains/i.test(task + '\n' + notes) &&
        /personal|life|search/i.test(task);

    const relFiles = listFilesRecursive(dir);
    const fixtures = relFiles.map((rel) => ({
        localPath: path.join(dir, rel),
        destRelativePath: rel,
        mimeType: guessMime(rel),
    }));

    const fixtureHint =
        fixtures.length > 0
            ? `\n\nWorkspace fixtures already uploaded (paths relative to agent workspace):\n` +
              fixtures.map((f) => `- ${f.destRelativePath}`).join('\n')
            : '';

    const prompt = [
        task,
        '',
        'Constraints:',
        constraints || '- Local shell/files OK; do not send email; do not git push',
        '',
        'Done when:',
        doneWhen || '- Task completed with real workspace outputs',
        fixtureHint,
        '',
        'When finished, print absolute paths and sizes of any created files. Stop once done — do not over-verify.',
    ]
        .filter((x) => x !== undefined)
        .join('\n')
        .trim();

    return {
        slug,
        title,
        tool,
        task,
        constraints,
        doneWhen,
        notes,
        prompt,
        personalContext,
        fixtures,
    };
};
