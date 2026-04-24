import { createAuthenticatedOpencodeSdkClient, createOpencodeAgentSessionId } from './opencodeSdkHelpers';

async function main() {
    const curTimeValueOf = Date.now();
    const workspaceDirectory = `/app/files-${curTimeValueOf}`;

    const baseUrl = (process.env.OPENCODE_API_BASE_URL || '').trim();
    if (!baseUrl) {
        throw new Error('Missing env OPENCODE_API_BASE_URL');
    }

    const apiKey = (process.env.OPENCODE_API_KEY || '').trim();
    const basicAuthUsername = (process.env.OPENCODE_BASIC_AUTH_USERNAME || '').trim();
    const basicAuthPassword = process.env.OPENCODE_BASIC_AUTH_PASSWORD || '';

    const client = await createAuthenticatedOpencodeSdkClient({
        baseUrl,
        workspaceDirectory,
        apiKey: apiKey || undefined,
        basicAuth: basicAuthPassword.trim().length >= 1 ? { username: basicAuthUsername || 'opencode', password: basicAuthPassword } : undefined,
    });

    const sessionId = await createOpencodeAgentSessionId(client);

    const prompt = `create pdf that display hello world ${new Date().toLocaleString()}. You may install any library or run any command. The output should be in /app/files-${curTimeValueOf}/output/ folder`;

    const providerID = (process.env.OPENCODE_TASK_PROVIDER_ID || '').trim();
    const modelID = (process.env.OPENCODE_TASK_MODEL_ID || '').trim();

    await client.session.promptAsync({
        path: { id: sessionId },
        body: {
            model:
                providerID.length >= 1 && modelID.length >= 1
                    ? {
                          providerID,
                          modelID,
                      }
                    : undefined,
            parts: [{ type: 'text', text: prompt }],
        },
        query: { directory: workspaceDirectory },
    } as any);

    const timeoutMs = 3 * 60_000;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const listRes = await client.file.list({ query: { path: '/output', directory: workspaceDirectory } } as any);
        const files = (listRes as any)?.data;
        if (Array.isArray(files)) {
            const pdf = files.find((f: any) => typeof f?.name === 'string' && f.name.toLowerCase().endsWith('.pdf'));
            if (pdf) {
                // eslint-disable-next-line no-console
                console.log('✅ Found PDF:', pdf.path || pdf.name);
                return;
            }
        }
        await new Promise((r) => setTimeout(r, 6000));
        // eslint-disable-next-line no-console
        process.stdout.write('.');
    }

    throw new Error('Timeout waiting for PDF in /output');
}

main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error('❌ smokeTestOpencodePdf failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
});

