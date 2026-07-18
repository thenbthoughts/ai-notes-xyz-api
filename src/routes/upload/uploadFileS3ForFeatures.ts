import { Router, Request, Response } from 'express';
import fileUpload from 'express-fileupload';
import path from 'path';
import mongoose from 'mongoose';
import mime from 'mime';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelUserFileUpload } from '../../schema/schemaUser/SchemaUserFileUpload.schema';
import IUserFileUpload from '../../types/typesSchema/typesUser/SchemaUserFileUpload.types';
import { getFile, putFile, deleteFile } from '../../utils/upload/uploadFunc';
import { constructFeatureUploadObjectKey } from '../../utils/upload/constructFeatureUploadObjectKey';
import { getApiKeyByObject } from '../../utils/llm/llmCommonFunc';
import { ModelUserApiKey } from '../../schema/schemaUser/SchemaUserApiKey.schema';

// Router
const router = Router();

router.use(fileUpload({
    limits: { fileSize: 1024 * 1024 * 1024 },
}));

/** Parse a single HTTP Range header value into inclusive start/end, or null if invalid. */
const parseByteRange = (
    rangeHeader: string | undefined,
    totalSize: number,
): { start: number; end: number } | null => {
    if (!rangeHeader || totalSize <= 0) {
        return null;
    }
    const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
    if (!match) {
        return null;
    }

    const startStr = match[1];
    const endStr = match[2];
    let start: number;
    let end: number;

    if (startStr === '' && endStr !== '') {
        // suffix range: bytes=-500
        const suffixLength = parseInt(endStr, 10);
        if (Number.isNaN(suffixLength) || suffixLength <= 0) {
            return null;
        }
        start = Math.max(0, totalSize - suffixLength);
        end = totalSize - 1;
    } else if (startStr !== '') {
        start = parseInt(startStr, 10);
        end = endStr !== '' ? parseInt(endStr, 10) : totalSize - 1;
        if (Number.isNaN(start) || Number.isNaN(end)) {
            return null;
        }
    } else {
        return null;
    }

    if (start < 0 || start >= totalSize || start > end) {
        return null;
    }

    end = Math.min(end, totalSize - 1);
    return { start, end };
};

// Get File API — supports HTTP Range so <video>/<audio> can seek/stream
router.get(
    '/getFile',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const userId = res.locals.auth_userId;
            const userApiKey = getApiKeyByObject(res.locals.apiKey);

            const fileName = req.query.fileName as string;
            if (typeof fileName !== 'string') {
                return res.status(400).json({ message: 'File name must be a string' });
            }
            
            const fileRecord = await ModelUserFileUpload.findOne({ userId, fileUploadPath: fileName });
            if (!fileRecord) {
                return res.status(404).json({ message: 'File not found for the user' });
            }

            const storageType = fileRecord.storageType || 'gridfs';

            const s3Config = storageType === 's3' && userApiKey.apiKeyS3Valid ? {
                region: userApiKey.apiKeyS3Region || 'auto',
                endpoint: userApiKey.apiKeyS3Endpoint || '',
                accessKeyId: userApiKey.apiKeyS3AccessKeyId || '',
                secretAccessKey: userApiKey.apiKeyS3SecretAccessKey || '',
                bucketName: userApiKey.apiKeyS3BucketName || '',
            } : undefined;

            const knownSize =
                typeof fileRecord.size === 'number' && fileRecord.size > 0
                    ? fileRecord.size
                    : undefined;

            // When size is known, parse Range before fetching so we only read the needed bytes.
            // When size is unknown, fetch full file first, then slice if a Range was requested.
            const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range : undefined;
            const preparsedRange = knownSize ? parseByteRange(rangeHeader, knownSize) : null;

            if (rangeHeader && knownSize && !preparsedRange) {
                res.setHeader('Content-Range', `bytes */${knownSize}`);
                return res.status(416).json({ message: 'Requested range not satisfiable' });
            }

            const fileData = await getFile({
                fileName: fileRecord.fileUploadPath,
                storageType: storageType as 'gridfs' | 's3',
                s3Config,
                ...(preparsedRange ? { range: preparsedRange } : {}),
            });

            if (!fileData.success || !fileData.content) {
                return res.status(404).json({ message: fileData.error || 'File not found' });
            }

            const totalSize =
                knownSize ??
                fileData.totalSize ??
                fileData.content.length;

            const contentType =
                fileRecord.contentType ||
                fileData.contentType ||
                mime.getType(fileRecord.originalName || fileRecord.fileUploadPath) ||
                'application/octet-stream';
            res.setHeader('Content-Type', contentType);
            res.setHeader('Accept-Ranges', 'bytes');

            const safeName = (fileRecord.originalName || path.basename(fileRecord.fileUploadPath) || 'file').replace(
                /["\r\n]/g,
                '_',
            );
            const isPdf =
                contentType.toLowerCase().includes('pdf') || safeName.toLowerCase().endsWith('.pdf');
            const isShellGenerated = fileRecord.fileUploadPath.startsWith('shell/');
            const inlinePreview =
                req.query.inline === '1' ||
                req.query.preview === '1' ||
                req.query.disposition === 'inline';
            const disposition =
                isPdf && isShellGenerated && !inlinePreview ? 'attachment' : 'inline';
            res.setHeader('Content-Disposition', `${disposition}; filename="${safeName}"`);

            const range =
                preparsedRange ||
                (rangeHeader ? parseByteRange(rangeHeader, totalSize) : null);

            if (rangeHeader && !range) {
                res.setHeader('Content-Range', `bytes */${totalSize}`);
                return res.status(416).json({ message: 'Requested range not satisfiable' });
            }

            if (range) {
                // If we already fetched only the range from storage, content is the slice;
                // otherwise slice the full buffer (size was unknown at fetch time).
                const body = preparsedRange
                    ? fileData.content
                    : fileData.content.subarray(range.start, range.end + 1);

                res.status(206);
                res.setHeader(
                    'Content-Range',
                    `bytes ${range.start}-${range.end}/${totalSize}`,
                );
                res.setHeader('Content-Length', body.length.toString());
                return res.send(body);
            }

            res.setHeader('Content-Length', fileData.content.length.toString());
            return res.send(fileData.content);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

const constructFilePath = (
    userId: string,
    parentEntityId: string,
    fileName: string,
    fileExtension: string
): { filePath: string; success: boolean } => ({
    success: true,
    filePath: constructFeatureUploadObjectKey(userId, parentEntityId, fileName, fileExtension),
});

// Upload File API
router.post(
    '/uploadFile',
    middlewareUserAuth,
    async (req: Request, res: Response): Promise<Response> => {
        try {
            const userId = res.locals.auth_userId;
            const userApiKey = getApiKeyByObject(res.locals.apiKey);

            // Validate file upload
            if (!req.files || Object.keys(req.files).length === 0) {
                return res.status(400).json({ message: 'No file uploaded' });
            }

            const file = req.files.file as fileUpload.UploadedFile;
            if (Array.isArray(file)) {
                return res.status(400).json({ message: 'Only one file can be uploaded at a time' });
            }

            // Validate request body parameters
            const { parentEntityId } = req.body;
            
            // Get storage type from user configuration (defaults to gridfs)
            const storageType = userApiKey.fileStorageType || 'gridfs';

            if (!parentEntityId) {
                return res.status(400).json({
                    message: 'Missing required parameters: parentEntityId'
                });
            }

            // Validate ObjectIds
            if (!mongoose.Types.ObjectId.isValid(parentEntityId)) {
                return res.status(400).json({ message: 'Invalid parentEntityId format' });
            }

            // Validate storage type
            const validStorageType = storageType === 's3' ? 's3' : 'gridfs';
            if (validStorageType === 's3' && !userApiKey.apiKeyS3Valid) {
                return res.status(400).json({ message: 'S3 credentials not configured' });
            }

            // Get file extension from original file
            const fileExtension = path.extname(file.name);

            // Create temporary file record first
            let fileRecordObj = await ModelUserFileUpload.create({
                userId: userId,
                fileUploadPath: `ai-notes-xyz/${userId}/temp/${new Date().valueOf()}.temp`,
                storageType: validStorageType,
            }) as IUserFileUpload;

            // Use the generated MongoDB _id as the filename
            const fileName = fileRecordObj._id.toString();

            // Construct file path (for backward compatibility)
            const resultConstructFilePath = constructFilePath(
                userId,
                parentEntityId,
                fileName,
                fileExtension,
            );

            const objectKey = resultConstructFilePath.filePath;

            // Prepare S3 config if needed
            const s3Config = validStorageType === 's3' ? {
                region: userApiKey.apiKeyS3Region || 'auto',
                endpoint: userApiKey.apiKeyS3Endpoint || '',
                accessKeyId: userApiKey.apiKeyS3AccessKeyId || '',
                secretAccessKey: userApiKey.apiKeyS3SecretAccessKey || '',
                bucketName: userApiKey.apiKeyS3BucketName || '',
            } : undefined;

            // Upload to storage
            const uploadResult = await putFile({
                fileName: objectKey,
                fileContent: file.data,
                contentType: file.mimetype,
                metadata: {
                    userId,
                    parentEntityId,
                    originalName: file.name,
                },
                storageType: validStorageType,
                s3Config,
            });

            if (!uploadResult.success) {
                // Clean up record on failure
                await ModelUserFileUpload.deleteOne({ _id: fileRecordObj._id });
                return res.status(500).json({ message: uploadResult.error || 'Upload failed' });
            }

            // Store file reference in database
            const updateData: any = {
                fileUploadPath: objectKey,
                storageType: validStorageType,
                parentEntityId: parentEntityId,
                contentType: file.mimetype,
                originalName: file.name,
                size: file.size,
            };

            if (validStorageType === 'gridfs' && uploadResult.fileId) {
                updateData.gridFsId = new mongoose.Types.ObjectId(uploadResult.fileId);
            }

            const resultInsert = await ModelUserFileUpload.findOneAndUpdate(
                { _id: fileRecordObj._id },
                { $set: updateData },
                { new: true }
            );
            console.log(resultInsert);

            return res.status(201).json({
                message: 'File uploaded successfully',
                fileName: objectKey,
                filePath: objectKey,
                storageType: validStorageType,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Delete File API
export const deleteFilesByParentEntityId = async ({
    userId,
    parentEntityId,
}: {
    userId: string;
    parentEntityId: string;
}): Promise<{
    success: boolean;
    error: string;
}> => {
    try {
        let prefix = `ai-notes-xyz/${userId}/features/${parentEntityId}/`;

        // Get file records from database that match the prefix
        const fileRecords = await ModelUserFileUpload.find({
            userId,
            fileUploadPath: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` }
        });

        if (fileRecords.length === 0) {
            return {
                success: false,
                error: 'No files found for this entity',
            };
        }

        // Delete each file from storage and database
        const deletePromises = fileRecords.map(async (fileRecord) => {
            try {
                // Validate that the file path starts with the expected prefix
                if (!fileRecord.fileUploadPath.startsWith(prefix)) {
                    console.error(`File path ${fileRecord.fileUploadPath} does not match expected prefix ${prefix}`);
                    return;
                }

                // Delete from storage
                const storageType = fileRecord.storageType || 'gridfs';
                const fileId = storageType === 'gridfs' 
                    ? (fileRecord.gridFsId?.toString() || fileRecord.fileUploadPath)
                    : fileRecord.fileUploadPath;

                const userApiKeyDoc = await ModelUserApiKey.findOne({ userId });
                const userApiKey = userApiKeyDoc ? getApiKeyByObject(userApiKeyDoc) : undefined;

                const s3Config = storageType === 's3' && userApiKey?.apiKeyS3Valid ? {
                    region: userApiKey.apiKeyS3Region || 'auto',
                    endpoint: userApiKey.apiKeyS3Endpoint || '',
                    accessKeyId: userApiKey.apiKeyS3AccessKeyId || '',
                    secretAccessKey: userApiKey.apiKeyS3SecretAccessKey || '',
                    bucketName: userApiKey.apiKeyS3BucketName || '',
                } : undefined;

                await deleteFile({
                    fileName: fileId,
                    storageType: storageType as 'gridfs' | 's3',
                    s3Config,
                });

                // Delete from database
                await ModelUserFileUpload.deleteOne({ _id: fileRecord._id });
            } catch (error) {
                console.error(`Error deleting file ${fileRecord.fileUploadPath}:`, error);
            }
        });

        await Promise.all(deletePromises);

        return {
            success: true,
            error: '',
        };
    } catch (error) {
        console.error(error);
        return {
            success: false,
            error: error as string || 'Server error',
        };
    }
}

// Delete File by path
export const deleteFileByPath = async ({
    userId,
    parentEntityId,
    fileName,
}: {
    userId: string;
    parentEntityId: string;
    fileName: string;
}): Promise<{
    success: boolean;
    error: string;
}> => {
    try {
        // Generate the file path
        const filePath = `ai-notes-xyz/${userId}/features/${parentEntityId}/${fileName}`;

        // Find file record
        const fileRecord = await ModelUserFileUpload.findOne({
            userId,
            fileUploadPath: filePath,
        });

        if (!fileRecord) {
            return {
                success: false,
                error: 'File not found',
            };
        }

        // Delete from storage
        const storageType = fileRecord.storageType || 'gridfs';
        const fileId = storageType === 'gridfs' 
            ? (fileRecord.gridFsId?.toString() || filePath)
            : filePath;

        const userApiKeyDoc = await ModelUserApiKey.findOne({ userId });
        const userApiKey = userApiKeyDoc ? getApiKeyByObject(userApiKeyDoc) : undefined;

        const s3Config = storageType === 's3' && userApiKey?.apiKeyS3Valid ? {
            region: userApiKey.apiKeyS3Region || 'auto',
            endpoint: userApiKey.apiKeyS3Endpoint || '',
            accessKeyId: userApiKey.apiKeyS3AccessKeyId || '',
            secretAccessKey: userApiKey.apiKeyS3SecretAccessKey || '',
            bucketName: userApiKey.apiKeyS3BucketName || '',
        } : undefined;

        const deleteResult = await deleteFile({
            fileName: fileId,
            storageType: storageType as 'gridfs' | 's3',
            s3Config,
        });

        if (!deleteResult.success) {
            return {
                success: false,
                error: deleteResult.error || 'Failed to delete file',
            };
        }

        // Delete from database
        await ModelUserFileUpload.deleteOne({
            userId,
            fileUploadPath: filePath,
        });

        return {
            success: true,
            error: '',
        };
    } catch (error) {
        console.error(error);
        return {
            success: false,
            error: error as string || 'Server error',
        };
    }
}

export default router;