import axios from 'axios';
import { ModelUserApiKey } from '../../schema/schemaUser/SchemaUserApiKey.schema';
import { ModelUserNotification } from '../../schema/schemaUser/SchemaUserNotification';

function htmlToPlain(html: string): string {
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export const funcSendTelegram = async ({
    username,
    subject,
    text,
    html,
}: {
    username: string;
    subject: string;
    text: string;
    html?: string;
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
        const chatId = apiKeys.telegramChatId?.trim() || '';
        const threadRaw = apiKeys.telegramMessageThreadId;
        const messageThreadId =
            typeof threadRaw === 'number' && threadRaw > 0 ? threadRaw : null;

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
            telegramChatId: chatId,
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
