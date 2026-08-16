import axios from 'axios';

type OmniparserElement = {
    x: number;
    y: number;
    width: number;
    height: number;
    type?: string;
    text?: string;
    interactivity?: boolean;
};

type OmniparserResult = {
    elements: OmniparserElement[];
    raw?: unknown;
};

/**
 * Call Replicate microsoft/omniparser-v2 with image base64 or URL.
 * Requires valid Replicate API key (apiKeyReplicate).
 * Simple, maintainable, generic — no hardcoded question logic.
 */
export const callOmniparser = async (params: {
    replicateApiKey: string;
    imageBase64?: string;
    imageUrl?: string;
    timeoutMs?: number;
}): Promise<OmniparserResult> => {
    const { replicateApiKey, imageBase64, imageUrl, timeoutMs = 120_000 } = params;
    if (!replicateApiKey?.trim()) throw new Error('Replicate API key missing');
    if (!imageBase64 && !imageUrl) throw new Error('Omniparser requires imageBase64 or imageUrl');

    const headers = {
        Authorization: `Token ${replicateApiKey.trim()}`,
        'Content-Type': 'application/json',
    };

    // Create prediction
    const createRes = await axios.post(
        'https://api.replicate.com/v1/predictions',
        {
            version: 'microsoft/omniparser-v2', // Replicate will resolve latest version; if needed, use full version hash
            input: imageBase64 ? { image: `data:image/png;base64,${imageBase64}` } : { image: imageUrl },
        },
        { headers, timeout: 30_000, validateStatus: () => true }
    );

    if (createRes.status < 200 || createRes.status >= 300) {
        const msg = typeof createRes.data?.detail === 'string' ? createRes.data.detail : JSON.stringify(createRes.data || {}).slice(0, 1000);
        throw new Error(`Omniparser create failed ${createRes.status}: ${msg}`);
    }

    const prediction = createRes.data as { id?: string; status?: string; output?: unknown; error?: string; urls?: { get?: string } };
    let getUrl = prediction.urls?.get || (prediction.id ? `https://api.replicate.com/v1/predictions/${prediction.id}` : '');
    if (!getUrl) throw new Error('Omniparser: missing prediction URL');

    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        await new Promise((r) => setTimeout(r, 2500));
        const pollRes = await axios.get(getUrl, { headers: { Authorization: headers.Authorization }, timeout: 15_000, validateStatus: () => true });
        if (pollRes.status < 200 || pollRes.status >= 300) continue;
        const data = pollRes.data as { status?: string; output?: unknown; error?: string };
        if (data.status === 'succeeded') {
            const output = data.output as unknown;
            // Try to parse elements from output (could be array or object with parsed elements)
            let elements: OmniparserElement[] = [];
            if (Array.isArray(output)) {
                elements = output as OmniparserElement[];
            } else if (output && typeof output === 'object') {
                const o = output as Record<string, unknown>;
                if (Array.isArray(o.elements)) elements = o.elements as OmniparserElement[];
                else if (Array.isArray(o.parsed)) elements = o.parsed as OmniparserElement[];
                else if (typeof o.output === 'string') {
                    try { const parsed = JSON.parse(o.output); if (Array.isArray(parsed)) elements = parsed; } catch {}
                }
            }
            return { elements, raw: output };
        }
        if (data.status === 'failed' || data.status === 'canceled') {
            throw new Error(`Omniparser failed: ${data.error || data.status}`);
        }
    }
    throw new Error('Omniparser timeout');
};
