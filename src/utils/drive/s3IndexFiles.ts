import { S3Client, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';
import { ModelS3FileIndex } from '../../schema/schemaDrive/SchemaS3FileIndex.schema';
import IUserS3Bucket from '../../types/typesSchema/typesDrive/SchemaUserS3Bucket.types';
import path from 'path';

interface IndexFilesResult {
    indexed: number;
    errors: number;
}

const indexFilesFromS3 = async ({
    bucket,
    username,
    prefix = '',
}: {
    bucket: IUserS3Bucket;
    username: string;
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
    
    // Track which files we've seen during this indexing session
    const seenFileKeys = new Set<string>();
    
    console.log(`Starting indexing for bucket: ${bucket.bucketName}, prefix: ${prefix}, fullPrefix: ${fullPrefix}`);
    
    do {
        try {
            const params: any = {
                Bucket: bucket.bucketName,
                MaxKeys: 1000,
                Delimiter: '/', // Important for folder structure
            };
            
            if (fullPrefix) {
                params.Prefix = fullPrefix + '/';
            }
            
            if (continuationToken) {
                params.ContinuationToken = continuationToken;
            }
            
            const command = new ListObjectsV2Command(params);
            const response = await s3Client.send(command);
            
            // Debug logging (commented out for performance, uncomment if needed)
            // console.log('S3 ListObjectsV2 response:', {
            //     prefix: params.Prefix,
            //     contentsCount: response.Contents?.length || 0,
            //     commonPrefixesCount: response.CommonPrefixes?.length || 0,
            //     commonPrefixes: response.CommonPrefixes?.map(p => p.Prefix) || [],
            // });
            
            if (response.Contents) {
                for (const item of response.Contents) {
                    if (!item.Key) continue;
                    
                    try {
                        // Get file metadata
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
                            // If HeadObject fails, continue with default values
                            console.warn(`Failed to get metadata for ${item.Key}: ${headError}`);
                        }
                        
                        // Determine if it's a folder marker (ends with '/')
                        const isFolderMarker = item.Key.endsWith('/');
                        
                        // Skip folder markers - we'll handle folders via CommonPrefixes
                        if (isFolderMarker) {
                            continue;
                        }
                        
                        // Extract path information
                        // relativeKey should be the path relative to fullPrefix (bucket prefix + indexing prefix)
                        let relativeKey = item.Key;
                        if (fullPrefix) {
                            // Remove the fullPrefix from the beginning of the key
                            const prefixRegex = new RegExp(`^${fullPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?`);
                            relativeKey = item.Key.replace(prefixRegex, '');
                        }
                        
                        // Skip if relativeKey is empty (this means the key IS the prefix itself)
                        if (!relativeKey || relativeKey === '') {
                            continue;
                        }
                        
                        // Create fileKeyArr from fileKey (split by '/')
                        const fileKeyArr = item.Key.split('/').filter((part: string) => part.length > 0);
                        
                        const pathParts = relativeKey.split('/').filter((part: string) => part.length > 0);
                        const fileName = pathParts[pathParts.length - 1] || '';
                        
                        // Remove bucket prefix if exists (needed for parent path calculation and folder creation)
                        const bucketPrefixArr = bucket.prefix ? bucket.prefix.split('/').filter((p: string) => p) : [];
                        const keyWithoutBucketPrefix = bucketPrefixArr.length > 0
                            ? fileKeyArr.slice(bucketPrefixArr.length)
                            : fileKeyArr;
                        
                        // Determine parent path using fileKeyArr
                        let parentPath = '';
                        if (keyWithoutBucketPrefix.length > 1) {
                            const parentKeyArr = keyWithoutBucketPrefix.slice(0, -1);
                            parentPath = parentKeyArr.join('/');
                        } else if (keyWithoutBucketPrefix.length === 1) {
                            // File is at root level (after bucket prefix)
                            parentPath = '';
                        }
                        
                        // Determine file type from extension
                        const ext = path.extname(fileName).toLowerCase().replace('.', '');
                        const fileType = ext || 'unknown';
                        
                        // Track this file as seen
                        seenFileKeys.add(item.Key);
                        
                        // Create or update index entry (replace if exists, add if new)
                        await ModelS3FileIndex.findOneAndUpdate(
                            {
                                username,
                                bucketName: bucket.bucketName,
                                fileKey: item.Key,
                            },
                            {
                                username,
                                bucketName: bucket.bucketName,
                                fileKey: item.Key,
                                fileKeyArr: fileKeyArr,
                                filePath: relativeKey,
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
                        
                        // Track parent folders to create (we'll create them after processing all files in this batch)
                        // This avoids duplicate database operations for folders that appear in multiple file paths
                        if (keyWithoutBucketPrefix.length > 1) {
                            // Build parent folder paths from root to immediate parent
                            for (let i = 1; i < keyWithoutBucketPrefix.length; i++) {
                                const parentFolderKeyArr = keyWithoutBucketPrefix.slice(0, i);
                                const parentFolderPath = parentFolderKeyArr.join('/');
                                const parentFolderName = parentFolderKeyArr[i - 1];
                                
                                // Construct the full S3 key for this parent folder
                                const parentFolderS3Key = bucketPrefixArr.length > 0
                                    ? [...bucketPrefixArr, ...parentFolderKeyArr].join('/') + '/'
                                    : parentFolderKeyArr.join('/') + '/';
                                
                                // Skip if we've already seen this folder in this batch
                                if (seenFileKeys.has(parentFolderS3Key)) {
                                    continue;
                                }
                                
                                // Mark as seen to avoid duplicates
                                seenFileKeys.add(parentFolderS3Key);
                                
                                // Calculate parent path for this folder
                                const folderParentPath = i > 1 
                                    ? parentFolderKeyArr.slice(0, i - 1).join('/')
                                    : '';
                                
                                // Create folder entry (using upsert, so it's safe to call multiple times)
                                const parentFolderFileKeyArr = parentFolderS3Key.split('/').filter((part: string) => part.length > 0);
                                
                                try {
                                    await ModelS3FileIndex.findOneAndUpdate(
                                        {
                                            username,
                                            bucketName: bucket.bucketName,
                                            fileKey: parentFolderS3Key,
                                        },
                                        {
                                            username,
                                            bucketName: bucket.bucketName,
                                            fileKey: parentFolderS3Key,
                                            fileKeyArr: parentFolderFileKeyArr,
                                            filePath: parentFolderPath,
                                            fileName: parentFolderName,
                                            fileType: 'folder',
                                            fileSize: 0,
                                            contentType: '',
                                            isFolder: true,
                                            parentPath: folderParentPath,
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
                                    console.error(`Error creating parent folder ${parentFolderS3Key}: ${folderError}`);
                                    errors++;
                                }
                            }
                        }
                    } catch (itemError) {
                        console.error(`Error indexing file ${item.Key}: ${itemError}`);
                        errors++;
                    }
                }
            }
            
            // Also index folders from CommonPrefixes
            if (response.CommonPrefixes && response.CommonPrefixes.length > 0) {
                for (const prefixItem of response.CommonPrefixes) {
                    if (!prefixItem.Prefix) {
                        continue;
                    }
                    
                    try {
                        // Create fileKeyArr from prefix (split by '/')
                        const fileKeyArr = prefixItem.Prefix.split('/').filter((part: string) => part.length > 0);
                        
                        // Remove bucket prefix from fileKeyArr to get the relative path parts
                        const bucketPrefixArr = bucket.prefix ? bucket.prefix.split('/').filter((p: string) => p) : [];
                        const keyWithoutBucketPrefix = bucketPrefixArr.length > 0
                            ? fileKeyArr.slice(bucketPrefixArr.length)
                            : fileKeyArr;
                        
                        if (keyWithoutBucketPrefix.length === 0) {
                            continue;
                        }
                        
                        // filePath is the full path from bucket root (after bucket prefix)
                        // This is what we use for navigation
                        const filePath = keyWithoutBucketPrefix.join('/');
                        
                        // fileName is just the folder name (last part)
                        const fileName = keyWithoutBucketPrefix[keyWithoutBucketPrefix.length - 1];
                        
                        // Determine parent path
                        let parentPath = '';
                        if (keyWithoutBucketPrefix.length > 1) {
                            const parentKeyArr = keyWithoutBucketPrefix.slice(0, -1);
                            parentPath = parentKeyArr.join('/');
                        } else {
                            // Folder is at root level (after bucket prefix)
                            parentPath = '';
                        }
                        
                        // Track this folder as seen
                        seenFileKeys.add(prefixItem.Prefix);
                        
                        await ModelS3FileIndex.findOneAndUpdate(
                            {
                                username,
                                bucketName: bucket.bucketName,
                                fileKey: prefixItem.Prefix,
                            },
                            {
                                username,
                                bucketName: bucket.bucketName,
                                fileKey: prefixItem.Prefix,
                                fileKeyArr: fileKeyArr,
                                filePath: filePath,
                                fileName,
                                fileType: 'folder',
                                fileSize: 0,
                                contentType: '',
                                isFolder: true,
                                parentPath,
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
                        console.error(`Error indexing folder ${prefixItem.Prefix}: ${folderError}`);
                        errors++;
                    }
                }
            }
            
            continuationToken = response.NextContinuationToken;
            
            console.log(`Indexed batch: ${indexed} items so far, ${errors} errors`);
        } catch (error) {
            console.error(`Error during indexing batch: ${error}`);
            console.error(error);
            errors++;
            break;
        }
    } while (continuationToken);
    
    console.log(`Indexing complete: ${indexed} items indexed, ${errors} errors`);
    return { indexed, errors };
};

export {
    indexFilesFromS3,
    IndexFilesResult,
};

