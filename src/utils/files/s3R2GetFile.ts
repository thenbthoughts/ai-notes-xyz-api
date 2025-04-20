import envKeys from '../../config/envKeys';
import { S3Client, GetObjectCommand, GetObjectCommandOutput } from '@aws-sdk/client-s3';
import { tsUserApiKey } from '../llm/llmCommonFunc';


const getFileFromS3R2 = async ({
    fileName,
    userApiKey,
}: {
    fileName: string;
    userApiKey: tsUserApiKey,
}): Promise<GetObjectCommandOutput | null> => {
    try {
        const s3Client = new S3Client({
            region: userApiKey.apiKeyS3Region,
            endpoint: userApiKey.apiKeyS3Endpoint,
            credentials: {
                accessKeyId: userApiKey.apiKeyS3AccessKeyId,
                secretAccessKey: userApiKey.apiKeyS3SecretAccessKey,
            },
        });

        const params = {
            Bucket: userApiKey.apiKeyS3BucketName,
            Key: fileName,
        };

        const data = await s3Client.send(new GetObjectCommand(params));
        return data;
    } catch (error) {
        console.error(`Error fetching file from S3: ${error}`);
        return null;
    }
};

export {
    getFileFromS3R2,
};


