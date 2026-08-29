import mongoose from 'mongoose';
import { GridFSBucket, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

// ==========================================
// TYPES
// ==========================================

export type StorageType = 'gridfs' | 's3';

export interface S3Config {
    region: string;
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketName: string;
}

export interface PutFileOptions {
    fileName: string;
    fileContent: Buffer | string;
    contentType?: string;
    metadata?: Record<string, any>;
    storageType?: StorageType;
    s3Config?: S3Config;
}

export interface GetFileOptions {
    fileName: string;
    storageType?: StorageType;
    s3Config?: S3Config;
    /** Inclusive byte range for partial reads (HTTP Range / video seeking). */
    range?: { start: number; end: number };
}

export interface PutFileResult {
    success: boolean;
    fileId?: string;
    error?: string;
}

export interface GetFileResult {
    success: boolean;
    content?: Buffer;
    contentType?: string;
    /** Total file size in bytes (full object, not just the returned slice). */
    totalSize?: number;
    error?: string;
}

export interface DeleteFileResult {
    success: boolean;
    error?: string;
}

// ==========================================
// HELPER: Get GridFS Bucket
// ==========================================

const getGridFSBucket = (): GridFSBucket => {
    const db = mongoose.connection.db;
    if (!db) {
        throw new Error('MongoDB connection not established');
    }
    return new GridFSBucket(db, { bucketName: 'uploads' });
};

// ==========================================
// PUT FILE (Upload)
// ==========================================

/**
 * Upload a file to storage (S3 or GridFS)
 * 
 * @example
 * // Upload to GridFS (default)
 * const result = await putFile({
 *   fileName: 'document.pdf',
 *   fileContent: buffer,
 *   contentType: 'application/pdf'
 * });
 * 
 * @example
 * // Upload to S3
 * const result = await putFile({
 *   fileName: 'document.pdf',
 *   fileContent: buffer,
 *   storageType: 's3',
 *   s3Config: {
 *     region: 'auto',
 *     endpoint: 'https://your-endpoint.r2.cloudflarestorage.com',
 *     accessKeyId: 'your-key',
 *     secretAccessKey: 'your-secret',
 *     bucketName: 'your-bucket'
 *   }
 * });
 */
export const putFile = async (options: PutFileOptions): Promise<PutFileResult> => {
    const {
        fileName,
        fileContent,
        contentType,
        metadata,
        storageType = 'gridfs',
        s3Config
    } = options;

    try {
        // GridFS Upload
        if (storageType === 'gridfs') {
            const bucket = getGridFSBucket();
            const fileBuffer = Buffer.isBuffer(fileContent)
                ? fileContent
                : Buffer.from(fileContent);

            const gridFsId = await new Promise<ObjectId>((resolve, reject) => {
                const uploadStream = bucket.openUploadStream(fileName, {
                    contentType: contentType || 'application/octet-stream',
                    metadata: metadata || {},
                });

                uploadStream.on('error', reject);
                uploadStream.on('finish', () => resolve(uploadStream.id as ObjectId));
                uploadStream.end(fileBuffer);
            });

            return {
                success: true,
                fileId: gridFsId.toString(),
            };
        }

        // S3 Upload
        if (storageType === 's3') {
            if (!s3Config) {
                return {
                    success: false,
                    error: 'S3 storage requires s3Config',
                };
            }

            const s3Client = new S3Client({
                region: s3Config.region,
                endpoint: s3Config.endpoint,
                credentials: {
                    accessKeyId: s3Config.accessKeyId,
                    secretAccessKey: s3Config.secretAccessKey,
                },
            });

            await s3Client.send(
                new PutObjectCommand({
                    Bucket: s3Config.bucketName,
                    Key: fileName,
                    Body: fileContent,
                })
            );

            return {
                success: true,
                fileId: fileName,
            };
        }

        return {
            success: false,
            error: `Unsupported storage type: ${storageType}`,
        };
    } catch (error: any) {
        return {
            success: false,
            error: error?.message || String(error),
        };
    }
};

// ==========================================
// GET FILE (Download)
// ==========================================

/**
 * Download a file from storage (S3 or GridFS)
 * 
 * @example
 * // Download from GridFS (default)
 * const result = await getFile({
 *   fileName: '507f1f77bcf86cd799439011' // GridFS ObjectId
 * });
 * 
 * @example
 * // Download from S3
 * const result = await getFile({
 *   fileName: 'document.pdf',
 *   storageType: 's3',
 *   s3Config: {
 *     region: 'auto',
 *     endpoint: 'https://your-endpoint.r2.cloudflarestorage.com',
 *     accessKeyId: 'your-key',
 *     secretAccessKey: 'your-secret',
 *     bucketName: 'your-bucket'
 *   }
 * });
 */
export const getFile = async (options: GetFileOptions): Promise<GetFileResult> => {
    const { fileName, storageType = 'gridfs', s3Config, range } = options;
    try {
        // GridFS Download
        if (storageType === 'gridfs') {
            const bucket = getGridFSBucket();
            // const fileId = new ObjectId(fileName);

            // Check if file exists
            const files = await bucket.find({ filename: fileName }).toArray();
            console.log('files gridfs: ', files);
            if (files.length === 0) {
                return {
                    success: false,
                    error: 'File not found in GridFS',
                };
            }

            const fileInfo = files[0];
            const totalSize = typeof fileInfo.length === 'number' ? fileInfo.length : undefined;
            // GridFS end is exclusive; HTTP Range end is inclusive
            const downloadStream = range
                ? bucket.openDownloadStream(fileInfo._id, {
                    start: range.start,
                    end: range.end + 1,
                })
                : bucket.openDownloadStream(fileInfo._id);

            // Convert stream to buffer
            const chunks: Uint8Array[] = [];
            for await (const chunk of downloadStream) {
                chunks.push(chunk);
            }
            const content = Buffer.concat(chunks);

            return {
                success: true,
                content,
                contentType: fileInfo.contentType,
                totalSize,
            };
        }

        // S3 Download
        if (storageType === 's3') {
            if (!s3Config) {
                return {
                    success: false,
                    error: 'S3 storage requires s3Config',
                };
            }

            const s3Client = new S3Client({
                region: s3Config.region,
                endpoint: s3Config.endpoint,
                credentials: {
                    accessKeyId: s3Config.accessKeyId,
                    secretAccessKey: s3Config.secretAccessKey,
                },
            });

            const s3Object = await s3Client.send(
                new GetObjectCommand({
                    Bucket: s3Config.bucketName,
                    Key: fileName,
                    ...(range
                        ? { Range: `bytes=${range.start}-${range.end}` }
                        : {}),
                })
            );

            if (!s3Object.Body) {
                return {
                    success: false,
                    error: 'File not found in S3',
                };
            }

            // Convert stream to buffer
            const chunks: Uint8Array[] = [];
            const stream = s3Object.Body as NodeJS.ReadableStream;
            for await (const chunk of stream) {
                if (typeof chunk === 'string') {
                    chunks.push(new Uint8Array(
                        Buffer.from(chunk).buffer,
                        Buffer.from(chunk).byteOffset,
                        Buffer.from(chunk).byteLength
                    ));
                } else {
                    chunks.push(new Uint8Array(
                        chunk.buffer,
                        chunk.byteOffset,
                        chunk.byteLength
                    ));
                }
            }
            const content = Buffer.concat(chunks);

            let totalSize: number | undefined;
            if (s3Object.ContentRange) {
                // e.g. "bytes 0-1023/2048"
                const totalMatch = /\/(\d+)$/.exec(s3Object.ContentRange);
                if (totalMatch) {
                    totalSize = parseInt(totalMatch[1], 10);
                }
            } else if (typeof s3Object.ContentLength === 'number') {
                totalSize = s3Object.ContentLength;
            }

            return {
                success: true,
                content,
                contentType: s3Object.ContentType,
                totalSize,
            };
        }

        return {
            success: false,
            error: `Unsupported storage type: ${storageType}`,
        };
    } catch (error: any) {
        return {
            success: false,
            error: error?.message || String(error),
        };
    }
};

// ==========================================
// DELETE FILE
// ==========================================

/**
 * Delete a file from storage (S3 or GridFS)
 * 
 * @example
 * // Delete from GridFS (default)
 * const result = await deleteFile({
 *   fileName: '507f1f77bcf86cd799439011' // GridFS ObjectId
 * });
 * 
 * @example
 * // Delete from S3
 * const result = await deleteFile({
 *   fileName: 'document.pdf',
 *   storageType: 's3',
 *   s3Config: {
 *     region: 'auto',
 *     endpoint: 'https://your-endpoint.r2.cloudflarestorage.com',
 *     accessKeyId: 'your-key',
 *     secretAccessKey: 'your-secret',
 *     bucketName: 'your-bucket'
 *   }
 * });
 */
export const deleteFile = async ({
    fileName,
    storageType = 'gridfs',
    s3Config,
}: {
    fileName: string;
    storageType?: StorageType;
    s3Config?: S3Config;
}): Promise<DeleteFileResult> => {
    try {
        // GridFS Delete
        if (storageType === 'gridfs') {
            const bucket = getGridFSBucket();
            const fileId = new ObjectId(fileName);
            await bucket.delete(fileId);

            return { success: true };
        }

        // S3 Delete
        if (storageType === 's3') {
            if (!s3Config) {
                return {
                    success: false,
                    error: 'S3 storage requires s3Config',
                };
            }

            const s3Client = new S3Client({
                region: s3Config.region,
                endpoint: s3Config.endpoint,
                credentials: {
                    accessKeyId: s3Config.accessKeyId,
                    secretAccessKey: s3Config.secretAccessKey,
                },
            });

            await s3Client.send(
                new DeleteObjectCommand({
                    Bucket: s3Config.bucketName,
                    Key: fileName,
                })
            );

            return { success: true };
        }

        return {
            success: false,
            error: `Unsupported storage type: ${storageType}`,
        };
    } catch (error: any) {
        return {
            success: false,
            error: error?.message || String(error),
        };
    }
};
