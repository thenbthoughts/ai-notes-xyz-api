import { S3Client, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';
import { ModelS3FileIndex } from '../../schema/schemaDrive/SchemaS3FileIndex.schema';
import IUserS3Bucket from '../../types/typesSchema/typesDrive/SchemaUserS3Bucket.types';
import path from 'path';

interface IndexFilesResult {
    indexed: number;
    errors: number;
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Recursively index all objects under a prefix (no Delimiter),
 * derive folder entries from key paths, and prune stale index rows.
 */
const indexFilesFromS3 = async ({
    bucket,
    userId,
    prefix = '',
}: {
    bucket: IUserS3Bucket;
    userId: string;
    prefix?: string;
}): Promise<IndexFilesResult> => {
    const s3Client = new S3Client({
        region: bucket.region,
        endpoint: bucket.endpoint,
        credentials: {
            accessKeyId: bucket.accessKeyId,
            secretAccessKey: bucket.secretAccessKey,
        },
    });

    const fullPrefix = bucket.prefix
        ? `${bucket.prefix.replace(/\/$/, '')}/${prefix.replace(/^\//, '')}`.replace(/\/$/, '')
        : prefix.replace(/^\//, '').replace(/\/$/, '');

    let continuationToken: string | undefined;
    let indexed = 0;
    let errors = 0;
    const indexedAt = new Date();
    const seenFileKeys = new Set<string>();
    const folderKeysToUpsert = new Map<
        string,
        {
            fileKey: string;
            fileKeyArr: string[];
            filePath: string;
            fileName: string;
            parentPath: string;
        }
    >();

    const bucketPrefixArr = bucket.prefix
        ? bucket.prefix.split('/').filter((p: string) => p)
        : [];

    console.log(
        `Starting indexing for bucket: ${bucket.bucketName}, prefix: ${prefix}, fullPrefix: ${fullPrefix}`
    );

    do {
        try {
            const params: {
                Bucket: string;
                MaxKeys: number;
                Prefix?: string;
                ContinuationToken?: string;
            } = {
                Bucket: bucket.bucketName,
                MaxKeys: 1000,
            };

            if (fullPrefix) {
                params.Prefix = fullPrefix.endsWith('/') ? fullPrefix : `${fullPrefix}/`;
            }

            if (continuationToken) {
                params.ContinuationToken = continuationToken;
            }

            const command = new ListObjectsV2Command(params);
            const response = await s3Client.send(command);

            if (response.Contents) {
                for (const item of response.Contents) {
                    if (!item.Key) continue;

                    try {
                        // Skip folder marker objects — folders are derived from paths
                        if (item.Key.endsWith('/')) {
                            continue;
                        }

                        let contentType = '';
                        let fileSize = item.Size || 0;

                        try {
                            const headCommand = new HeadObjectCommand({
                                Bucket: bucket.bucketName,
                                Key: item.Key,
                            });
                            const headResponse = await s3Client.send(headCommand);
                            contentType = headResponse.ContentType || '';
                            fileSize = headResponse.ContentLength || fileSize;
                        } catch (headError) {
                            console.warn(`Failed to get metadata for ${item.Key}: ${headError}`);
                        }

                        let relativeKey = item.Key;
                        if (fullPrefix) {
                            const prefixRegex = new RegExp(
                                `^${escapeRegex(fullPrefix)}/?`
                            );
                            relativeKey = item.Key.replace(prefixRegex, '');
                        }

                        // When indexing a subfolder, relativeKey is still relative to fullPrefix.
                        // Navigation uses paths relative to the bucket prefix only.
                        const fileKeyArr = item.Key.split('/').filter(
                            (part: string) => part.length > 0
                        );
                        const keyWithoutBucketPrefix =
                            bucketPrefixArr.length > 0
                                ? fileKeyArr.slice(bucketPrefixArr.length)
                                : fileKeyArr;

                        if (keyWithoutBucketPrefix.length === 0) {
                            continue;
                        }

                        const fileName =
                            keyWithoutBucketPrefix[keyWithoutBucketPrefix.length - 1] || '';
                        const filePath = keyWithoutBucketPrefix.join('/');
                        const parentPath =
                            keyWithoutBucketPrefix.length > 1
                                ? keyWithoutBucketPrefix.slice(0, -1).join('/')
                                : '';

                        // If relativeKey became empty, key was the prefix itself
                        if (!relativeKey) {
                            continue;
                        }

                        const ext = path.extname(fileName).toLowerCase().replace('.', '');
                        const fileType = ext || 'unknown';

                        seenFileKeys.add(item.Key);

                        await ModelS3FileIndex.findOneAndUpdate(
                            {
                                userId,
                                bucketName: bucket.bucketName,
                                fileKey: item.Key,
                            },
                            {
                                userId,
                                bucketName: bucket.bucketName,
                                fileKey: item.Key,
                                fileKeyArr,
                                filePath,
                                fileName,
                                fileType,
                                fileSize,
                                contentType,
                                isFolder: false,
                                parentPath,
                                lastModified: item.LastModified || new Date(),
                                indexedAt,
                            },
                            {
                                upsert: true,
                                new: true,
                            }
                        );

                        indexed++;

                        // Queue ancestor folders
                        for (let i = 1; i < keyWithoutBucketPrefix.length; i++) {
                            const parentFolderKeyArr = keyWithoutBucketPrefix.slice(0, i);
                            const parentFolderPath = parentFolderKeyArr.join('/');
                            const parentFolderName = parentFolderKeyArr[i - 1];
                            const parentFolderS3Key =
                                bucketPrefixArr.length > 0
                                    ? [...bucketPrefixArr, ...parentFolderKeyArr].join('/') +
                                      '/'
                                    : parentFolderKeyArr.join('/') + '/';

                            if (folderKeysToUpsert.has(parentFolderS3Key)) {
                                continue;
                            }

                            folderKeysToUpsert.set(parentFolderS3Key, {
                                fileKey: parentFolderS3Key,
                                fileKeyArr: parentFolderS3Key
                                    .split('/')
                                    .filter((part: string) => part.length > 0),
                                filePath: parentFolderPath,
                                fileName: parentFolderName,
                                parentPath:
                                    i > 1
                                        ? parentFolderKeyArr.slice(0, i - 1).join('/')
                                        : '',
                            });
                        }
                    } catch (itemError) {
                        console.error(`Error indexing file ${item.Key}: ${itemError}`);
                        errors++;
                    }
                }
            }

            continuationToken = response.NextContinuationToken;
            console.log(`Indexed batch: ${indexed} files so far, ${errors} errors`);
        } catch (error) {
            console.error(`Error during indexing batch: ${error}`);
            console.error(error);
            errors++;
            break;
        }
    } while (continuationToken);

    // Upsert derived folders
    for (const folder of folderKeysToUpsert.values()) {
        try {
            seenFileKeys.add(folder.fileKey);
            await ModelS3FileIndex.findOneAndUpdate(
                {
                    userId,
                    bucketName: bucket.bucketName,
                    fileKey: folder.fileKey,
                },
                {
                    userId,
                    bucketName: bucket.bucketName,
                    fileKey: folder.fileKey,
                    fileKeyArr: folder.fileKeyArr,
                    filePath: folder.filePath,
                    fileName: folder.fileName,
                    fileType: 'folder',
                    fileSize: 0,
                    contentType: '',
                    isFolder: true,
                    parentPath: folder.parentPath,
                    lastModified: new Date(),
                    indexedAt,
                },
                {
                    upsert: true,
                    new: true,
                }
            );
            indexed++;
        } catch (folderError) {
            console.error(`Error creating folder ${folder.fileKey}: ${folderError}`);
            errors++;
        }
    }

    // Prune stale index entries under this prefix that were not seen
    try {
        const seenArr = Array.from(seenFileKeys);
        const staleQuery: Record<string, unknown> = {
            userId,
            bucketName: bucket.bucketName,
        };

        if (fullPrefix) {
            const prefixForMatch = fullPrefix.endsWith('/') ? fullPrefix : `${fullPrefix}/`;
            staleQuery.$and = [
                { fileKey: { $nin: seenArr } },
                { fileKey: { $regex: `^${escapeRegex(prefixForMatch)}` } },
            ];
        } else {
            staleQuery.fileKey = { $nin: seenArr };
        }

        const deleteResult = await ModelS3FileIndex.deleteMany(staleQuery);
        if (deleteResult.deletedCount && deleteResult.deletedCount > 0) {
            console.log(`Pruned ${deleteResult.deletedCount} stale index entries`);
        }
    } catch (pruneError) {
        console.error(`Error pruning stale index entries: ${pruneError}`);
        errors++;
    }

    console.log(`Indexing complete: ${indexed} items indexed, ${errors} errors`);
    return { indexed, errors };
};

export { indexFilesFromS3, IndexFilesResult };
