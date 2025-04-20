import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { tsUserApiKey } from '../llm/llmCommonFunc';

const putFileToS3 = async ({
    fileName,
    fileContent,

    userApiKey,
}: {
    fileName: string,
    fileContent: Buffer | string;

    userApiKey: tsUserApiKey,
}): Promise<{
    uploadStatus: boolean,
    error: string,
}> => {
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
            Body: fileContent,
        };

        await s3Client.send(new PutObjectCommand(params));
        return {
            uploadStatus: true,
            error: '',
        };
    } catch (error: any) {
        console.error(`Error uploading file to S3: ${error}`);
        let errorStr = '';
        if(typeof error === 'object') {
            if(typeof error?.message === 'string') {
                errorStr = error?.message;
            }
        }
        if(typeof error === 'string') {
            errorStr = error;
        }
        return {
            uploadStatus: false,
            error: errorStr,
        };
    }
};

export {
    putFileToS3,
};


