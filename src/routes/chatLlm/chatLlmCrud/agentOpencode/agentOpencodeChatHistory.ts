import mongoose from 'mongoose';

import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import {
    AGENT_OPENCODE_RUNNING_MESSAGE,
    AGENT_OPENCODE_SETTINGS_MESSAGE,
    AGENT_OPENCODE_STARTED_MESSAGE,
    AGENT_OPENCODE_UPLOADS_DIR,
} from './agentOpencodeConstants';
import type { AgentOpencodeSyncedUpload } from './agentOpencodeSyncUploads';

const MAX_MESSAGES = 200;
const MAX_MESSAGE_CHARS = 8_000;
const MAX_HISTORY_CHARS = 80_000;

const isPlaceholderContent = (content: string): boolean => {
    const text = content.trim();
    if (!text) return true;
    if (text === AGENT_OPENCODE_STARTED_MESSAGE) return true;
    if (text === AGENT_OPENCODE_SETTINGS_MESSAGE) return true;
    if (text === AGENT_OPENCODE_RUNNING_MESSAGE) return true;
    if (text.startsWith('Agent (Opencode) started.')) return true;
    if (text.startsWith('Agent (Opencode) failed.')) return true;
    return false;
};

const collectFileUrls = (msg: {
    fileUrl?: unknown;
    fileUrlArr?: unknown;
}): string[] => {
    const urls: string[] = [];
    if (typeof msg.fileUrl === 'string' && msg.fileUrl.trim()) {
        urls.push(msg.fileUrl.trim());
    }
    if (Array.isArray(msg.fileUrlArr)) {
        for (const item of msg.fileUrlArr) {
            if (typeof item === 'string' && item.trim()) urls.push(item.trim());
        }
    } else if (typeof msg.fileUrlArr === 'string' && msg.fileUrlArr.trim()) {
        urls.push(msg.fileUrlArr.trim());
    }
    return [...new Set(urls)];
};

const clip = (value: string, max: number): string => {
    const text = value.trim();
    if (text.length <= max) return text;
    return `${text.slice(0, max)}\n\n…(truncated)`;
};

const lookupUpload = (
    fileUrl: string,
    uploads: AgentOpencodeSyncedUpload[]
): AgentOpencodeSyncedUpload | undefined =>
    uploads.find(
        (item) =>
            item.fileUploadPath === fileUrl ||
            item.fileUploadPath.endsWith(fileUrl) ||
            fileUrl.endsWith(item.fileUploadPath) ||
            fileUrl.endsWith(item.originalName)
    );

export const buildAgentOpencodeChatHistoryMarkdown = async ({
    threadId,
    userId,
    skipChatMessageId,
    currentPrompt,
    uploads,
}: {
    threadId: mongoose.Types.ObjectId | string;
    userId: mongoose.Types.ObjectId | string;
    skipChatMessageId?: mongoose.Types.ObjectId | string | null;
    currentPrompt: string;
    uploads: AgentOpencodeSyncedUpload[];
}): Promise<{ markdown: string; priorTurnCount: number }> => {
    const skipId = skipChatMessageId ? String(skipChatMessageId) : '';
    const msgs = await ModelChatLlm.find({
        threadId,
        userId,
    })
        .sort({ createdAtUtc: 1 })
        .limit(MAX_MESSAGES)
        .select('isAi type content fileUrl fileUrlArr fileContentText createdAtUtc')
        .lean();

    const lines: string[] = [
        '# Chat history',
        '',
        'This is the full conversation for this thread.',
        `Attached files are under \`${AGENT_OPENCODE_UPLOADS_DIR}/\`.`,
        '',
    ];

    if (uploads.length > 0) {
        lines.push('## Attached files', '');
        for (const file of uploads) {
            lines.push(`- \`${file.workspaceRelPath}\` (${file.originalName})`);
        }
        lines.push('');
    }

    let priorTurnCount = 0;
    for (const msg of msgs) {
        if (skipId && String(msg._id) === skipId) {
            continue;
        }
        const content = typeof msg.content === 'string' ? msg.content : '';
        const fileUrls = collectFileUrls(msg);
        if (msg.isAi && isPlaceholderContent(content) && fileUrls.length === 0) {
            continue;
        }
        const role = msg.isAi ? 'Assistant' : 'User';
        const body = clip(content, MAX_MESSAGE_CHARS);
        const fileLines = fileUrls.map((url) => {
            const matched = lookupUpload(url, uploads);
            return matched
                ? `- \`${matched.workspaceRelPath}\` (${matched.originalName})`
                : `- ${url}`;
        });
        const excerpt =
            typeof msg.fileContentText === 'string' && msg.fileContentText.trim()
                ? clip(msg.fileContentText, 500)
                : '';

        if (!body && fileLines.length === 0 && !excerpt) {
            continue;
        }

        lines.push(`## ${role}`);
        if (body) lines.push('', body);
        if (fileLines.length > 0) {
            lines.push('', 'Files:', ...fileLines);
        }
        if (excerpt) {
            lines.push('', 'File text excerpt:', '', excerpt);
        }
        lines.push('');
        priorTurnCount += 1;
    }

    const current = currentPrompt.trim() || '(empty prompt)';
    lines.push('## User (current)', '', current, '');

    let markdown = lines.join('\n').trim() + '\n';
    if (markdown.length > MAX_HISTORY_CHARS) {
        markdown =
            markdown.slice(0, MAX_HISTORY_CHARS) +
            '\n\n…(chat history truncated; the latest user message is still above)\n';
    }
    return { markdown, priorTurnCount };
};
