/**
 * Shell safety for agent execute_script / shell commands.
 *
 * Allowed: local shell work, package installs, git clone/fetch/pull, drafting email content as files.
 * Blocked: actually sending mail / SMS / webhooks, git push / force-push / remote publish.
 */

export type ShellSafetyResult = {
    ok: boolean;
    reason?: string;
};

const normalize = (text: string): string =>
    String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\\\n/g, ' ')
        .replace(/#.*$/gm, ' ')
        .replace(/\/\*[\s\S]*?\*\//g, ' ');

/** Patterns that indicate an outbound send / remote publish — not drafting content. */
const BLOCKED_PATTERNS: Array<{ re: RegExp; reason: string }> = [
    {
        re: /\bgit\s+push\b/i,
        reason: 'git push is blocked — clone/fetch/pull and local commits are allowed; do not publish to remotes',
    },
    {
        re: /\bgit\s+push\s+--force\b|\bgit\s+push\s+-f\b|\b--force-with-lease\b/i,
        reason: 'git force-push is blocked',
    },
    {
        re: /\b(sendmail|mailx|msmtp|postfix)\b/i,
        reason: 'sending email via system mail tools is blocked — draft email content to a file instead',
    },
    {
        re: /\b(nodemailer|smtplib|email\.mime)\b[\s\S]{0,200}\.(sendmail|send_message|send\()/i,
        reason: 'sending email via SMTP libraries is blocked — draft email content to a file instead',
    },
    {
        re: /\b(smtplib\.SMTP|SMTP_SSL|createTransport)\b[\s\S]{0,300}\.(sendmail|sendMail|send_message|send\()/i,
        reason: 'SMTP send is blocked — write a draft .eml/.txt/.md file instead of sending',
    },
    {
        re: /\bcurl\b[\s\S]{0,120}\b(smtp:|smtps:|mailto:)/i,
        reason: 'outbound mail via curl is blocked',
    },
    {
        re: /\b(twilio|vonage|nexmo)\b[\s\S]{0,120}\.(messages|sms|create)\b/i,
        reason: 'sending SMS via provider APIs is blocked',
    },
];

/**
 * Returns ok=false when command or script body attempts blocked outbound actions.
 * Drafting email bodies, git clone, and ordinary shell work are allowed.
 */
export const assertAgentShellSafe = (source: string): ShellSafetyResult => {
    const text = normalize(source);
    if (!text.trim()) return { ok: true };

    for (const { re, reason } of BLOCKED_PATTERNS) {
        if (re.test(text)) {
            return { ok: false, reason };
        }
    }

    // Explicit "send this email" CLI patterns (keep draft/write free).
    if (
        /\b(echo|printf|cat)\b[\s\S]{0,80}\|\s*(mail|mailx|sendmail)\b/i.test(text) ||
        /\bmail\s+-s\b/i.test(text)
    ) {
        return {
            ok: false,
            reason: 'piping content into mail/sendmail is blocked — save a draft file instead',
        };
    }

    return { ok: true };
};
