import { randomBytes } from 'crypto';

const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Random alphanumeric token (MCP bearer, etc.). */
export const generateAlphanumericToken = (length = 48): string => {
    const bytes = randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i += 1) {
        out += ALPHANUM[bytes[i] % ALPHANUM.length];
    }
    return out;
};

export const isAlphanumericTokenShape = (value: string): boolean =>
    /^[A-Za-z0-9]{32,128}$/.test(String(value || '').trim());
