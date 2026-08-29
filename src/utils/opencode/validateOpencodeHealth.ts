/**
 * Validates OpenCode server via `@opencode-ai/sdk` `client.global.health()` with HTTP Basic auth.
 * Dynamic `import()` is required because the package is ESM-only while this service compiles to CommonJS.
 */
export async function validateOpencodeHealth(
    baseUrl: string,
    userId: string,
    password: string
): Promise<{ ok: true } | { ok: false; error: string }> {
    const trimmedBase = baseUrl.replace(/\/+$/, '');
    const auth = Buffer.from(`${userId}:${password}`).toString('base64');

    try {
        // Force native ESM dynamic import at runtime (TS CommonJS transform can turn import() into require()).
        const importOpencodeSdk = new Function(
            'return import("@opencode-ai/sdk/v2");'
        ) as () => Promise<typeof import('@opencode-ai/sdk/v2')>;
        const { createOpencodeClient } = await importOpencodeSdk();
        const client = createOpencodeClient({
            baseUrl: trimmedBase,
            headers: {
                Authorization: `Basic ${auth}`,
            },
        });

        const result = await client.global.health();

        if (result.error) {
            const msg =
                typeof result.error === 'object' &&
                result.error !== null &&
                'message' in result.error &&
                typeof (result.error as { message?: unknown }).message === 'string'
                    ? (result.error as { message: string }).message
                    : 'OpenCode health check failed';
            return { ok: false, error: msg };
        }

        const data = result.data as { healthy?: unknown } | undefined;
        if (data && typeof data === 'object' && data.healthy === true) {
            return { ok: true };
        }

        return {
            ok: false,
            error: 'OpenCode health check did not return healthy: true.',
        };
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return {
            ok: false,
            error: `Could not reach OpenCode server or SDK error: ${message}`,
        };
    }
}
