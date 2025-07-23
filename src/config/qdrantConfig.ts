import { QdrantClient } from "@qdrant/js-client-rest";

const getQdrantClient = async ({
    apiKeyQdrantEndpoint,
    apiKeyQdrantPassword,
}: {
    apiKeyQdrantEndpoint: string;
    apiKeyQdrantPassword: string;
}): Promise<QdrantClient | null> => {
    try {
        const qdrantUrl = new URL(apiKeyQdrantEndpoint);
        const config = {
            qdrant: {
                url: apiKeyQdrantEndpoint,
                port: parseInt(qdrantUrl.port || (qdrantUrl.protocol === 'https:' ? '443' : '80')),
                apiKey: apiKeyQdrantPassword,
            }
        };

        const qdrantClient = new QdrantClient({
            url: config.qdrant.url,
            port: config.qdrant.port,
            apiKey: config.qdrant.apiKey,
        });

        const resultQdrant = await qdrantClient.versionInfo();
        console.log('resultQdrant: ', resultQdrant);

        // Test creating a collection to verify write permissions
        try {
            const testCollectionName = `test_collection_${new Date().valueOf()}`;
            await qdrantClient.createCollection(testCollectionName, {
                vectors: {
                    size: 128,
                    distance: 'Cosine'
                }
            });

            // Insert a test record
            await qdrantClient.upsert(testCollectionName, {
                points: [{
                    id: 1,
                    vector: Array(128).fill(0.1),
                    payload: { test: true }
                }]
            });

            // Clean up test collection
            await qdrantClient.deleteCollection(testCollectionName);

        } catch (testError) {
            console.error('Qdrant test record insertion failed:', testError);

            return null;
        }

        return qdrantClient;
    } catch (error) {
        console.error('Error getting qdrant config:', error);
        return null;
    }
};

export { getQdrantClient };