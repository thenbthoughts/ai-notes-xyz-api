import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import path from 'path';
import fileUpload from 'express-fileupload';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelUserS3Bucket } from '../../schema/schemaDrive/SchemaUserS3Bucket.schema';
import { ModelS3FileIndex } from '../../schema/schemaDrive/SchemaS3FileIndex.schema';
import { indexFilesFromS3 } from '../../utils/drive/s3IndexFiles';
import { deleteFileFromS3 } from '../../utils/drive/s3DeleteFile';
import { createS3Client } from '../../utils/drive/s3ListFiles';
import { serializeDriveFile } from '../../utils/drive/driveApiHelpers';
import {
    validateDriveCreateFileName,
    validateDriveFolderPath,
    validateDrivePathSegment,
} from '../../utils/drive/drivePathValidation';
import {
    buildDriveFileLocation,
    upsertDriveFileIndex,
} from '../../utils/drive/driveUpsertIndex';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const router = Router();

const resolveContentTypeForCreate = (fileName: string): string => {
    const ext = path.extname(fileName).toLowerCase();
    if (ext === '.md' || ext === '.markdown') return 'text/markdown; charset=utf-8';
    if (ext === '.txt') return 'text/plain; charset=utf-8';
    return 'application/octet-stream';
};

// Get user's S3 buckets
router.get('/buckets', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        
        const buckets = await ModelUserS3Bucket.find({ userId }).sort({ createdAtUtc: -1 });
        
        return res.status(200).json({
            success: true,
            buckets: buckets.map(bucket => ({
                _id: bucket._id,
                bucketName: bucket.bucketName,
                endpoint: bucket.endpoint,
                region: bucket.region,
                prefix: bucket.prefix || '',
                isActive: bucket.isActive,
                createdAtUtc: bucket.createdAtUtc,
                updatedAtUtc: bucket.updatedAtUtc,
            })),
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Add new S3 bucket
router.post('/buckets', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const { bucketName, endpoint, region, accessKeyId, secretAccessKey, prefix } = req.body;
        
        if (!bucketName || !endpoint || !region || !accessKeyId || !secretAccessKey) {
            return res.status(400).json({ message: 'Missing required fields' });
        }
        
        const bucket = await ModelUserS3Bucket.create({
            userId,
            bucketName,
            endpoint,
            region,
            accessKeyId,
            secretAccessKey,
            prefix: prefix || '',
            isActive: true,
            createdAtUtc: new Date(),
            updatedAtUtc: new Date(),
        });
        
        return res.status(201).json({
            success: true,
            bucket: {
                _id: bucket._id,
                bucketName: bucket.bucketName,
                endpoint: bucket.endpoint,
                region: bucket.region,
                prefix: bucket.prefix,
                isActive: bucket.isActive,
            },
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Update S3 bucket
router.put('/buckets/:id', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const { id } = req.params;
        const { bucketName, endpoint, region, accessKeyId, secretAccessKey, prefix, isActive } = req.body;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid bucket ID' });
        }
        
        const bucket = await ModelUserS3Bucket.findOne({ _id: id, userId });
        if (!bucket) {
            return res.status(404).json({ message: 'Bucket not found' });
        }
        
        const updateData: any = {
            updatedAtUtc: new Date(),
        };
        
        if (bucketName) updateData.bucketName = bucketName;
        if (endpoint) updateData.endpoint = endpoint;
        if (region) updateData.region = region;
        if (accessKeyId) updateData.accessKeyId = accessKeyId;
        if (secretAccessKey) updateData.secretAccessKey = secretAccessKey;
        if (prefix !== undefined) updateData.prefix = prefix;
        if (typeof isActive === 'boolean') updateData.isActive = isActive;
        
        await ModelUserS3Bucket.updateOne({ _id: id, userId }, updateData);
        
        const updatedBucket = await ModelUserS3Bucket.findById(id);
        
        return res.status(200).json({
            success: true,
            bucket: updatedBucket ? {
                _id: updatedBucket._id,
                bucketName: updatedBucket.bucketName,
                endpoint: updatedBucket.endpoint,
                region: updatedBucket.region,
                prefix: updatedBucket.prefix,
                isActive: updatedBucket.isActive,
            } : null,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Delete S3 bucket
router.delete('/buckets/:id', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid bucket ID' });
        }
        
        const bucket = await ModelUserS3Bucket.findOne({ _id: id, userId });
        if (!bucket) {
            return res.status(404).json({ message: 'Bucket not found' });
        }
        
        // Delete all indexed files for this bucket
        await ModelS3FileIndex.deleteMany({ userId, bucketName: bucket.bucketName });
        
        // Delete the bucket
        await ModelUserS3Bucket.deleteOne({ _id: id, userId });
        
        return res.status(200).json({ success: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Reindex files for a bucket
router.post('/index/:bucketName', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const { bucketName } = req.params;
        const { prefix } = req.body;
        
        const bucket = await ModelUserS3Bucket.findOne({ userId, bucketName });
        if (!bucket) {
            return res.status(404).json({ message: 'Bucket not found' });
        }
        
        const result = await indexFilesFromS3({
            bucket,
            userId,
            prefix: prefix || '',
        });
        
        return res.status(200).json({
            success: true,
            indexed: result.indexed,
            errors: result.errors,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// List files/folders (folder browse)
router.post('/files', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const { bucketName, parentPath = '', page = 1, perPage = 10000 } = req.body;

        if (!bucketName) {
            return res.status(400).json({ message: 'bucketName is required' });
        }

        const bucket = await ModelUserS3Bucket.findOne({ userId, bucketName });
        if (!bucket) {
            return res.status(404).json({ message: 'Bucket not found' });
        }

        const query: Record<string, unknown> = {
            userId,
            bucketName,
            parentPath: parentPath || '',
        };

        const skip = (page - 1) * perPage;

        const files = await ModelS3FileIndex.find(query)
            .sort({
                isFolder: -1,
                fileName: 1,
            })
            .skip(skip)
            .limit(perPage);

        const totalCount = await ModelS3FileIndex.countDocuments(query);

        return res.status(200).json({
            success: true,
            files: files.map(serializeDriveFile),
            pagination: {
                page,
                perPage,
                totalCount,
                totalPages: Math.ceil(totalCount / perPage),
            },
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// List folders (for folder picker)
router.post('/folders', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const { bucketName } = req.body;

        if (!bucketName) {
            return res.status(400).json({ message: 'bucketName is required' });
        }

        const bucket = await ModelUserS3Bucket.findOne({ userId, bucketName });
        if (!bucket) {
            return res.status(404).json({ message: 'Bucket not found' });
        }

        const folders = await ModelS3FileIndex.find({
            userId,
            bucketName,
            isFolder: true,
        })
            .sort({ filePath: 1 })
            .limit(5000);

        return res.status(200).json({
            success: true,
            folders: folders.map(serializeDriveFile),
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Create a new text or markdown file in a folder
router.post('/file', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const {
            bucketName,
            folderPath = '',
            fileName,
            fileType = 'txt',
            content = '',
            overwrite = false,
        } = req.body;

        if (!bucketName) {
            return res.status(400).json({ message: 'bucketName is required' });
        }

        const folderResult = validateDriveFolderPath(folderPath);
        if (!folderResult.valid) {
            return res.status(400).json({ message: folderResult.error });
        }

        const type = fileType === 'md' || fileType === 'markdown' ? 'md' : 'txt';
        const nameResult = validateDriveCreateFileName(fileName, type);
        if (!nameResult.valid) {
            return res.status(400).json({ message: nameResult.error });
        }

        if (typeof content !== 'string') {
            return res.status(400).json({ message: 'content must be a string' });
        }

        const bucket = await ModelUserS3Bucket.findOne({ userId, bucketName });
        if (!bucket) {
            return res.status(404).json({ message: 'Bucket not found' });
        }

        const location = buildDriveFileLocation({
            bucket,
            parentPath: folderResult.normalized,
            fileName: nameResult.normalized,
        });

        const existing = await ModelS3FileIndex.findOne({
            userId,
            bucketName,
            fileKey: location.fileKey,
        });
        if (existing && !overwrite) {
            return res.status(409).json({ message: 'A file with this name already exists in the folder' });
        }

        const contentType = resolveContentTypeForCreate(nameResult.normalized);
        const bodyBuffer = Buffer.from(content, 'utf-8');

        const s3Client = createS3Client(bucket);
        await s3Client.send(
            new PutObjectCommand({
                Bucket: bucket.bucketName,
                Key: location.fileKey,
                Body: bodyBuffer,
                ContentType: contentType,
            })
        );

        const { file } = await upsertDriveFileIndex({
            userId,
            bucket,
            parentPath: folderResult.normalized,
            fileName: nameResult.normalized,
            fileSize: bodyBuffer.byteLength,
            contentType,
        });

        return res.status(201).json({ success: true, file });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Upload a file into a folder (multipart)
router.post(
    '/upload',
    middlewareUserAuth,
    fileUpload({
        limits: { fileSize: 1024 * 1024 * 512 },
        abortOnLimit: true,
    }),
    async (req: Request, res: Response) => {
        try {
            const userId = res.locals.auth_userId;
            const bucketName = req.body?.bucketName as string | undefined;
            const folderPath = (req.body?.folderPath as string | undefined) ?? '';
            const overwrite =
                req.body?.overwrite === true ||
                req.body?.overwrite === 'true' ||
                req.body?.overwrite === '1';
            const customFileName = req.body?.fileName as string | undefined;

            if (!bucketName) {
                return res.status(400).json({ message: 'bucketName is required' });
            }

            if (!req.files || Object.keys(req.files).length === 0) {
                return res.status(400).json({ message: 'No file uploaded' });
            }

            const uploaded = req.files.file;
            if (!uploaded || Array.isArray(uploaded)) {
                return res.status(400).json({ message: 'Upload a single file using the "file" field' });
            }

            const folderResult = validateDriveFolderPath(folderPath);
            if (!folderResult.valid) {
                return res.status(400).json({ message: folderResult.error });
            }

            const rawName = (customFileName && String(customFileName).trim()) || uploaded.name;
            const nameResult = validateDrivePathSegment(rawName, 'file');
            if (!nameResult.valid) {
                return res.status(400).json({ message: nameResult.error });
            }

            const bucket = await ModelUserS3Bucket.findOne({ userId, bucketName });
            if (!bucket) {
                return res.status(404).json({ message: 'Bucket not found' });
            }

            const location = buildDriveFileLocation({
                bucket,
                parentPath: folderResult.normalized,
                fileName: nameResult.normalized,
            });

            const existing = await ModelS3FileIndex.findOne({
                userId,
                bucketName,
                fileKey: location.fileKey,
            });
            if (existing && !overwrite) {
                return res.status(409).json({ message: 'A file with this name already exists in the folder' });
            }

            const contentType =
                uploaded.mimetype ||
                resolveContentTypeForCreate(nameResult.normalized) ||
                'application/octet-stream';

            const s3Client = createS3Client(bucket);
            await s3Client.send(
                new PutObjectCommand({
                    Bucket: bucket.bucketName,
                    Key: location.fileKey,
                    Body: uploaded.data,
                    ContentType: contentType,
                })
            );

            const { file } = await upsertDriveFileIndex({
                userId,
                bucket,
                parentPath: folderResult.normalized,
                fileName: nameResult.normalized,
                fileSize: uploaded.size,
                contentType,
            });

            return res.status(201).json({ success: true, file });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Get file content
router.get('/file', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const bucketName = req.query.bucketName as string;
        const fileKey = req.query.fileKey as string;
        
        if (!bucketName || !fileKey) {
            return res.status(400).json({ message: 'bucketName and fileKey are required' });
        }
        
        // Verify file belongs to user
        const fileIndex = await ModelS3FileIndex.findOne({ userId, bucketName, fileKey });
        if (!fileIndex) {
            return res.status(404).json({ message: 'File not found' });
        }
        
        const bucket = await ModelUserS3Bucket.findOne({ userId, bucketName });
        if (!bucket) {
            return res.status(404).json({ message: 'Bucket not found' });
        }
        
        const s3Client = createS3Client(bucket);
        const command = new GetObjectCommand({
            Bucket: bucket.bucketName,
            Key: fileKey,
        });
        
        const data = await s3Client.send(command);
        
        // Set appropriate headers
        res.setHeader('Content-Type', fileIndex.contentType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${fileIndex.fileName}"`);
        
        if (data.ContentLength) {
            res.setHeader('Content-Length', data.ContentLength.toString());
        }
        
        // Stream the file
        (data.Body as NodeJS.ReadableStream).pipe(res);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Update file content (for text/md editing)
router.put('/file', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const { bucketName, fileKey, content } = req.body;
        
        if (!bucketName || !fileKey || content === undefined) {
            return res.status(400).json({ message: 'bucketName, fileKey, and content are required' });
        }
        
        // Verify file belongs to user
        const fileIndex = await ModelS3FileIndex.findOne({ userId, bucketName, fileKey });
        if (!fileIndex) {
            return res.status(404).json({ message: 'File not found' });
        }
        
        if (fileIndex.isFolder) {
            return res.status(400).json({ message: 'Cannot edit folder' });
        }
        
        const bucket = await ModelUserS3Bucket.findOne({ userId, bucketName });
        if (!bucket) {
            return res.status(404).json({ message: 'Bucket not found' });
        }
        
        const s3Client = createS3Client(bucket);
        const command = new PutObjectCommand({
            Bucket: bucket.bucketName,
            Key: fileKey,
            Body: Buffer.from(content, 'utf-8'),
            ContentType: fileIndex.contentType || 'text/plain',
        });
        
        await s3Client.send(command);
        
        // Update file index
        await ModelS3FileIndex.updateOne(
            { _id: fileIndex._id },
            {
                fileSize: Buffer.byteLength(content, 'utf-8'),
                lastModified: new Date(),
                indexedAt: new Date(),
            }
        );
        
        return res.status(200).json({ success: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Delete file or folder (folders: index-only cascade; files: S3 + index)
router.delete('/file', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const bucketName = req.query.bucketName as string;
        const fileKey = req.query.fileKey as string;
        
        if (!bucketName || !fileKey) {
            return res.status(400).json({ message: 'bucketName and fileKey are required' });
        }
        
        // Verify file belongs to user
        const fileIndex = await ModelS3FileIndex.findOne({ userId, bucketName, fileKey });
        if (!fileIndex) {
            return res.status(404).json({ message: 'File not found' });
        }
        
        const bucket = await ModelUserS3Bucket.findOne({ userId, bucketName });
        if (!bucket) {
            return res.status(404).json({ message: 'Bucket not found' });
        }

        // Folders are virtual index entries — remove this folder and descendants from the index
        if (fileIndex.isFolder) {
            const folderPath = fileIndex.filePath || '';
            const escapeRegex = (value: string) =>
                value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            await ModelS3FileIndex.deleteMany({
                userId,
                bucketName,
                $or: [
                    { _id: fileIndex._id },
                    { filePath: folderPath },
                    ...(folderPath
                        ? [
                              { filePath: { $regex: `^${escapeRegex(folderPath)}/` } },
                              { parentPath: folderPath },
                              { parentPath: { $regex: `^${escapeRegex(folderPath)}/` } },
                          ]
                        : []),
                ],
            });

            return res.status(200).json({ success: true });
        }
        
        // Delete from S3
        const deleteResult = await deleteFileFromS3({ bucket, fileKey });
        if (!deleteResult.success) {
            return res.status(500).json({ message: deleteResult.error || 'Failed to delete file' });
        }
        
        // Delete from index
        await ModelS3FileIndex.deleteOne({ _id: fileIndex._id });
        
        return res.status(200).json({ success: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;

