import { S3Client, ListObjectsV2Command, ListObjectsV2CommandOutput } from '@aws-sdk/client-s3';
import IUserS3Bucket from '../../types/typesSchema/typesDrive/SchemaUserS3Bucket.types';

interface S3FileItem {
    key: string;
    size: number;
    lastModified?: Date;
    contentType?: string;
}

interface S3ListFilesResult {
    files: S3FileItem[];
    folders: string[];
    hasMore: boolean;
    nextContinuationToken?: string;
}

const createS3Client = (bucket: IUserS3Bucket): S3Client => {
    return new S3Client({
        region: bucket.region,
        endpoint: bucket.endpoint,
        credentials: {
            accessKeyId: bucket.accessKeyId,
            secretAccessKey: bucket.secretAccessKey,
        },
    });
};

const listFilesFromS3 = async ({
    bucket,
    prefix = '',
    continuationToken,
    maxKeys = 1000,
}: {
    bucket: IUserS3Bucket;
    prefix?: string;
    continuationToken?: string;
    maxKeys?: number;
}): Promise<S3ListFilesResult> => {
    try {
        const s3Client = createS3Client(bucket);
        
        // Combine bucket prefix with requested prefix
        const fullPrefix = bucket.prefix 
            ? `${bucket.prefix.replace(/\/$/, '')}/${prefix.replace(/^\//, '')}`.replace(/\/$/, '')
            : prefix.replace(/^\//, '').replace(/\/$/, '');
        
        const params: any = {
            Bucket: bucket.bucketName,
            MaxKeys: maxKeys,
        };
        
        if (fullPrefix) {
            params.Prefix = fullPrefix + '/';
        }
        
        if (continuationToken) {
            params.ContinuationToken = continuationToken;
        }
        
        const command = new ListObjectsV2Command(params);
        const response: ListObjectsV2CommandOutput = await s3Client.send(command);
        
        const files: S3FileItem[] = [];
        const folderSet = new Set<string>();
        
        if (response.Contents) {
            for (const item of response.Contents) {
                if (!item.Key) continue;
                
                // Remove the full prefix from the key to get relative path
                const relativeKey = fullPrefix 
                    ? item.Key.replace(new RegExp(`^${fullPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`), '')
                    : item.Key;
                
                // Skip if it's the prefix itself (empty key after removal)
                if (!relativeKey) continue;
                
                // Check if it's a folder (ends with /) or has subfolders
                if (item.Key.endsWith('/')) {
                    // It's a folder marker
                    const folderName = relativeKey.replace(/\/$/, '');
                    if (folderName) {
                        folderSet.add(folderName);
                    }
                } else {
                    // It's a file
                    const pathParts = relativeKey.split('/');
                    if (pathParts.length > 1) {
                        // File is in a subfolder, add the folder
                        folderSet.add(pathParts[0]);
                    }
                    
                    files.push({
                        key: item.Key,
                        size: item.Size || 0,
                        lastModified: item.LastModified,
                        contentType: undefined, // ListObjectsV2 doesn't return ContentType
                    });
                }
            }
        }
        
        // Also process CommonPrefixes for folders
        if (response.CommonPrefixes) {
            for (const prefixItem of response.CommonPrefixes) {
                if (prefixItem.Prefix) {
                    const relativePrefix = fullPrefix 
                        ? prefixItem.Prefix.replace(new RegExp(`^${fullPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`), '')
                        : prefixItem.Prefix;
                    const folderName = relativePrefix.replace(/\/$/, '');
                    if (folderName) {
                        folderSet.add(folderName);
                    }
                }
            }
        }
        
        return {
            files,
            folders: Array.from(folderSet).sort(),
            hasMore: response.IsTruncated || false,
            nextContinuationToken: response.NextContinuationToken,
        };
    } catch (error) {
        console.error(`Error listing files from S3: ${error}`);
        throw error;
    }
};

export {
    listFilesFromS3,
    createS3Client,
    S3FileItem,
    S3ListFilesResult,
};

