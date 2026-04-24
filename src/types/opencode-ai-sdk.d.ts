/**
 * Ambient typings so the ESM-only `@opencode-ai/sdk` package type-checks under the API's
 * CommonJS `module` setting (without switching `moduleResolution` / `module` for the whole project).
 * Keep this aligned with methods used in `routes/chatLlm/chatLlmAgent/utils/opencodeSdkHelpers.ts`.
 */
declare module '@opencode-ai/sdk' {
    export interface OpencodeClientConfig {
        baseUrl?: string;
        directory?: string;
        headers?: Record<string, string>;
    }

    export interface OpencodeSdkError {
        [key: string]: unknown;
    }

    export interface OpencodeFieldsResponse<T> {
        data?: T;
        error?: OpencodeSdkError;
    }

    export interface OpencodeClient {
        session: {
            create: (
                opts?: unknown
            ) => Promise<OpencodeFieldsResponse<{ id?: string; session?: { id?: string } }>>;
            promptAsync: (opts: unknown) => Promise<unknown>;
            /** Per-session status map: session id → `{ type: 'idle' | 'busy' | ... }` */
            status: (opts?: unknown) => Promise<OpencodeFieldsResponse<Record<string, { type?: string }>>>;
            messages: (opts: unknown) => Promise<unknown>;
        };
        pty: {
            create: (opts: unknown) => Promise<OpencodeFieldsResponse<unknown>>;
        };
        auth: {
            set: (opts: unknown) => Promise<unknown>;
        };
        file: {
            list: (opts: unknown) => Promise<unknown>;
            read: (opts: unknown) => Promise<unknown>;
        };
    }

    export function createOpencodeClient(config?: OpencodeClientConfig): OpencodeClient;
}
