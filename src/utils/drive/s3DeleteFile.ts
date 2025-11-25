import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import IUserS3Bucket from '../../types/typesSchema/typesDrive/SchemaUserS3Bucket.types';

interface DeleteFileResult {
    success: boolean;
    error?: string;
}

const deleteFileFromS3 = async ({
    bucket,
    fileKey,
}: {
    bucket: IUserS3Bucket;
    fileKey: string;
}): Promise<DeleteFileResult> => {
    try {
        const s3Client = new S3Client({
            region: bucket.region,
            endpoint: bucket.endpoint,
            credentials: {
                accessKeyId: bucket.accessKeyId,
                secretAccessKey: bucket.secretAccessKey,
            },
        });
        
        const command = new DeleteObjectCommand({
            Bucket: bucket.bucketName,
            Key: fileKey,
        });
        
        await s3Client.send(command);
        
        return {
            success: true,
        };
    } catch (error: any) {
        console.error(`Error deleting file from S3: ${error}`);
        let errorStr = '';
        if (typeof error === 'object') {
            if (typeof error?.message === 'string') {
                errorStr = error.message;
            }
        }
        if (typeof error === 'string') {
            errorStr = error;
        }
        return {
            success: false,
            error: errorStr,
        };
    }
};

export {
    deleteFileFromS3,
    DeleteFileResult,
};

