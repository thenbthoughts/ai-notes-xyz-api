import axios from 'axios';
import { ModelUserApiKey } from '../../schema/schemaUser/SchemaUserApiKey.schema';
import { ModelUserNotification } from '../../schema/schemaUser/SchemaUserNotification';

/** Strip HTML for Telegram plain text; keeps line breaks from &lt;br&gt; and block closings. */
function htmlToPlain(html: string): string {
    let s = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
    s = s.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n');
    s = s.replace(/<hr\b[^>]*>/gi, '\n────────\n');
    s = s.replace(/<[^>]+>/g, '');
    s = s.replace(/&nbsp;/gi, ' ');
    s = s.replace(/&amp;/gi, '&');
    s = s.replace(/&lt;/gi, '<');
    s = s.replace(/&gt;/gi, '>');
    s = s.replace(/&#(\d+);/g, (_m, code: string) => {
        const n = Number(code);
        return Number.isFinite(n) ? String.fromCharCode(n) : '';
    });
    s = s.replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => {
        const n = parseInt(hex, 16);
        return Number.isFinite(n) ? String.fromCharCode(n) : '';
    });
    s = s.replace(/[ \t\f\v\u00a0]+/g, ' ');
    s = s.replace(/ *\n */g, '\n');
    s = s.replace(/\n{3,}/g, '\n\n');
    return s.trim();
}

export const funcSendTelegram = async ({
    username,
    subject,
    text,
    html,
    overrideChatId,
    overrideMessageThreadId,
}: {
    username: string;
    subject: string;
    text: string;
    html?: string;
    /** When set, send to this chat instead of the user’s saved default */
    overrideChatId?: string;
    overrideMessageThreadId?: number | null;
}): Promise<boolean> => {
    try {
        if (!username || !subject) {
            return false;
        }

        const apiKeys = await ModelUserApiKey.findOne({
            username: username,
        });

        if (!apiKeys) {
            return false;
        }

        const token = apiKeys.telegramBotToken?.trim() || '';
        let chatId = apiKeys.telegramChatId?.trim() || '';
        let messageThreadId: number | null = null;
        const threadRaw = apiKeys.telegramMessageThreadId;
        if (typeof threadRaw === 'number' && threadRaw > 0) {
            messageThreadId = threadRaw;
        }

        const overrideTrim =
            typeof overrideChatId === 'string' ? overrideChatId.trim() : '';
        if (overrideTrim.length >= 1) {
            chatId = overrideTrim;
            if (
                typeof overrideMessageThreadId === 'number' &&
                overrideMessageThreadId > 0
            ) {
                messageThreadId = overrideMessageThreadId;
            } else {
                messageThreadId = null;
            }
        }

        const parts: string[] = [subject];
        if (typeof text === 'string' && text.trim().length >= 1) {
            parts.push(text.trim());
        }
        if (typeof html === 'string' && html.trim().length >= 1) {
            parts.push(htmlToPlain(html));
        }
        let message = parts.join('\n\n');
        if (message.length > 4096) {
            message = message.slice(0, 4093) + '...';
        }

        await ModelUserNotification.create({
            username: username,
            smtpTo: '',
            subject: subject,
            text: message,
            html: '',
            channel: 'telegram',
            telegramChatId: chatId.length >= 1 ? chatId : '',
        });

        if (apiKeys.telegramValid !== true || !token || !chatId) {
            return false;
        }

        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        const sendBody: Record<string, unknown> = {
            chat_id: chatId,
            text: message,
        };
        if (messageThreadId != null) {
            sendBody.message_thread_id = messageThreadId;
        }
        const res = await axios.post<{ ok: boolean }>(url, sendBody, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 15_000,
        });

        return res.data?.ok === true;
    } catch (error) {
        console.error(error);
        return false;
    }
};
