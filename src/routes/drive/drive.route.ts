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
import { GetObjectCommand, PutObjectCommand, CopyObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { ModelDriveShareLink } from '../../schema/schemaDrive/SchemaDriveShareLink.schema';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const extractTextForIndex = async (buffer: Buffer, contentType: string, fileName: string): Promise<string> => {
    try {
        const ct = (contentType || '').toLowerCase();
        const ext = path.extname(fileName).toLowerCase();
        if (ct.includes('pdf') || ext === '.pdf') {
            try {
                const pdfParse = (await import('pdf-parse')).default as unknown as (b: Buffer) => Promise<{ text: string }>;
                const data = await pdfParse(buffer);
                return (data.text || '').slice(0, 20000);
            } catch {
                return '';
            }
        }
        if (ext === '.docx' || ct.includes('officedocument.wordprocessingml')) {
            try {
                const mammoth = await import('mammoth');
                const result = await mammoth.extractRawText({ buffer });
                return (result.value || '').slice(0, 20000);
            } catch {
                return '';
            }
        }
        if (ct.startsWith('text/') || ct.includes('json') || ct.includes('javascript') || ['.txt', '.md', '.markdown', '.csv', '.log', '.json', '.xml', '.yml', '.yaml', '.html', '.css', '.js', '.ts', '.py', '.java', '.c', '.cpp', '.sh'].includes(ext)) {
            return buffer.toString('utf-8').slice(0, 20000);
        }
        return '';
    } catch {
        return '';
    }
};

const buildS3KeyForPath = (bucket: { prefix?: string }, relativePath: string): string => {
    const prefixArr = bucket.prefix ? (bucket.prefix as string).split('/').filter((p: string) => p) : [];
    const relArr = relativePath ? relativePath.split('/').filter((p: string) => p.length > 0) : [];
    const arr = [...prefixArr, ...relArr];
    return arr.join('/');
};

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
            isTrashed: { $ne: true },
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
            isTrashed: { $ne: true },
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
        try {
            const text = content.slice(0, 20000);
            await ModelS3FileIndex.updateOne({ userId, bucketName, fileKey: location.fileKey }, { $set: { textContent: text } });
        } catch { /* ignore */ }

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
            try {
                const text = await extractTextForIndex(uploaded.data as Buffer, contentType, nameResult.normalized);
                if (text) await ModelS3FileIndex.updateOne({ userId, bucketName, fileKey: location.fileKey }, { $set: { textContent: text } });
            } catch { /* ignore */ }

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
        const prevContentBuf = Buffer.from('');
        let prevText = '';
        try {
            const getCmd = new GetObjectCommand({ Bucket: bucket.bucketName, Key: fileKey });
            const prevData = await s3Client.send(getCmd);
            const chunks: Buffer[] = [];
            for await (const chunk of prevData.Body as unknown as AsyncIterable<Buffer>) {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            const buf = Buffer.concat(chunks);
            prevText = buf.toString('utf-8').slice(0, 20000);
        } catch {
            prevText = '';
        }
        const command = new PutObjectCommand({
            Bucket: bucket.bucketName,
            Key: fileKey,
            Body: Buffer.from(content, 'utf-8'),
            ContentType: fileIndex.contentType || 'text/plain',
        });
        
        await s3Client.send(command);
        
        const newSize = Buffer.byteLength(content, 'utf-8');
        const textContent = content.slice(0, 20000);
        const versionEntry = prevText ? { content: prevText.slice(0, 5000), savedAt: new Date(), size: Buffer.byteLength(prevText, 'utf-8') } : null;
        const updatePatch: Record<string, unknown> = {
            fileSize: newSize,
            lastModified: new Date(),
            indexedAt: new Date(),
            textContent,
        };
        if (versionEntry) {
            const hist = Array.isArray((fileIndex as unknown as { versionHistory?: unknown[] }).versionHistory) ? (fileIndex as unknown as { versionHistory: Array<{ content: string; savedAt: Date; size: number }> }).versionHistory : [];
            const nextHist = [...hist, versionEntry].slice(-20);
            (updatePatch as Record<string, unknown>).versionHistory = nextHist;
        }
        await ModelS3FileIndex.updateOne(
            { _id: fileIndex._id },
            updatePatch
        );
        
        return res.status(200).json({ success: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Delete file or folder (folders: index-only cascade; files: S3 + index) supports soft trash via ?trash=1
router.delete('/file', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const bucketName = req.query.bucketName as string;
        const fileKey = req.query.fileKey as string;
        const toTrash = req.query.trash === '1' || req.query.trash === 'true';
        
        if (!bucketName || !fileKey) {
            return res.status(400).json({ message: 'bucketName and fileKey are required' });
        }
        
        const fileIndex = await ModelS3FileIndex.findOne({ userId, bucketName, fileKey });
        if (!fileIndex) {
            return res.status(404).json({ message: 'File not found' });
        }
        
        const bucket = await ModelUserS3Bucket.findOne({ userId, bucketName });
        if (!bucket) {
            return res.status(404).json({ message: 'Bucket not found' });
        }

        if (toTrash) {
            const now = new Date();
            if (fileIndex.isFolder) {
                const folderPath = fileIndex.filePath || '';
                const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                await ModelS3FileIndex.updateMany(
                    {
                        userId,
                        bucketName,
                        $or: [
                            { _id: fileIndex._id },
                            { filePath: folderPath },
                            ...(folderPath ? [{ filePath: { $regex: `^${escapeRegex(folderPath)}/` } }, { parentPath: folderPath }, { parentPath: { $regex: `^${escapeRegex(folderPath)}/` } }] : []),
                        ],
                    },
                    { $set: { isTrashed: true, trashedAt: now, originalParentPath: fileIndex.parentPath } }
                );
            } else {
                await ModelS3FileIndex.updateOne({ _id: fileIndex._id }, { $set: { isTrashed: true, trashedAt: now, originalParentPath: fileIndex.parentPath } });
            }
            return res.status(200).json({ success: true, trashed: true });
        }

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
        
        const deleteResult = await deleteFileFromS3({ bucket, fileKey });
        if (!deleteResult.success) {
            return res.status(500).json({ message: deleteResult.error || 'Failed to delete file' });
        }
        
        await ModelS3FileIndex.deleteOne({ _id: fileIndex._id });
        
        return res.status(200).json({ success: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/folder', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const { bucketName, parentPath = '', folderName } = req.body;
        if (!bucketName) return res.status(400).json({ message: 'bucketName is required' });
        const folderValidation = validateDrivePathSegment(folderName, 'folder');
        if (!folderValidation.valid) return res.status(400).json({ message: folderValidation.error });
        const parentValidation = validateDriveFolderPath(parentPath);
        if (!parentValidation.valid) return res.status(400).json({ message: parentValidation.error });
        const bucket = await ModelUserS3Bucket.findOne({ userId, bucketName });
        if (!bucket) return res.status(404).json({ message: 'Bucket not found' });
        const targetRelative = parentValidation.normalized ? `${parentValidation.normalized}/${folderValidation.normalized}` : folderValidation.normalized;
        const s3Key = buildS3KeyForPath(bucket, targetRelative) + '/';
        const existing = await ModelS3FileIndex.findOne({ userId, bucketName, fileKey: s3Key });
        if (existing) return res.status(409).json({ message: 'Folder already exists' });
        const s3Client = createS3Client(bucket);
        await s3Client.send(new PutObjectCommand({ Bucket: bucket.bucketName, Key: s3Key, Body: Buffer.from(''), ContentType: 'application/x-directory' }));
        const prefixArr = bucket.prefix ? bucket.prefix.split('/').filter((p: string) => p) : [];
        const relSegments = targetRelative.split('/').filter((p: string) => p.length > 0);
        const now = new Date();
        for (let i = 1; i <= relSegments.length; i++) {
            const folderSegments = relSegments.slice(0, i);
            const folderPath = folderSegments.join('/');
            const folderS3Key = prefixArr.length > 0 ? [...prefixArr, ...folderSegments].join('/') + '/' : folderSegments.join('/') + '/';
            await ModelS3FileIndex.findOneAndUpdate(
                { userId, bucketName, fileKey: folderS3Key },
                {
                    userId,
                    bucketName,
                    fileKey: folderS3Key,
                    fileKeyArr: folderS3Key.split('/').filter((p: string) => p.length > 0),
                    filePath: folderPath,
                    fileName: folderSegments[i - 1],
                    fileType: 'folder',
                    fileSize: 0,
                    contentType: '',
                    isFolder: true,
                    parentPath: i > 1 ? folderSegments.slice(0, i - 1).join('/') : '',
                    lastModified: now,
                    indexedAt: now,
                    isTrashed: false,
                },
                { upsert: true, new: true }
            );
        }
        const created = await ModelS3FileIndex.findOne({ userId, bucketName, fileKey: s3Key });
        return res.status(201).json({ success: true, folder: created ? serializeDriveFile(created as unknown as Parameters<typeof serializeDriveFile>[0]) : null });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/rename', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const { bucketName, fileKey, newName } = req.body;
        if (!bucketName || !fileKey || !newName) return res.status(400).json({ message: 'bucketName, fileKey and newName are required' });
        const fileIndex = await ModelS3FileIndex.findOne({ userId, bucketName, fileKey });
        if (!fileIndex) return res.status(404).json({ message: 'File not found' });
        const bucket = await ModelUserS3Bucket.findOne({ userId, bucketName });
        if (!bucket) return res.status(404).json({ message: 'Bucket not found' });
        const kind = fileIndex.isFolder ? 'folder' : 'file';
        const nameResult = validateDrivePathSegment(newName, kind);
        if (!nameResult.valid) return res.status(400).json({ message: nameResult.error });
        const s3Client = createS3Client(bucket);
        if (fileIndex.isFolder) {
            const oldPath = fileIndex.filePath;
            const parentDir = fileIndex.parentPath;
            const newPath = parentDir ? `${parentDir}/${nameResult.normalized}` : nameResult.normalized;
            const oldPrefix = buildS3KeyForPath(bucket, oldPath) + '/';
            const newPrefix = buildS3KeyForPath(bucket, newPath) + '/';
            const existing = await ModelS3FileIndex.findOne({ userId, bucketName, filePath: newPath, isFolder: true });
            if (existing) return res.status(409).json({ message: 'Folder with that name already exists' });
            const descendants = await ModelS3FileIndex.find({ userId, bucketName, $or: [{ fileKey: { $regex: `^${oldPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } }, { fileKey: fileIndex.fileKey }] });
            for (const doc of descendants) {
                const oldKey: string = (doc as unknown as { fileKey: string }).fileKey;
                const suffix = oldKey.startsWith(oldPrefix) ? oldKey.slice(oldPrefix.length) : '';
                const newKey = suffix ? `${newPrefix}${suffix}` : newPrefix;
                if (oldKey !== newKey) {
                    try {
                        await s3Client.send(new CopyObjectCommand({ Bucket: bucket.bucketName, CopySource: `${bucket.bucketName}/${oldKey}`, Key: newKey }));
                        await s3Client.send(new PutObjectCommand({ Bucket: bucket.bucketName, Key: oldKey, Body: undefined } as unknown as never));
                        const { DeleteObjectCommand: Del } = await import('@aws-sdk/client-s3');
                        await s3Client.send(new Del({ Bucket: bucket.bucketName, Key: oldKey }));
                    } catch {
                        // for virtual folder markers, S3 copy may fail if no object; still update index
                    }
                }
                const isFolderDoc = (doc as unknown as { isFolder: boolean }).isFolder;
                let newFilePath = '';
                let newParent = '';
                let newFileName = '';
                if (isFolderDoc) {
                    const fp: string = (doc as unknown as { filePath: string }).filePath;
                    if (fp === oldPath) {
                        newFilePath = newPath;
                        newParent = parentDir;
                        newFileName = nameResult.normalized;
                    } else if (fp.startsWith(oldPath + '/')) {
                        const rest = fp.slice(oldPath.length + 1);
                        newFilePath = `${newPath}/${rest}`;
                        const parts = newFilePath.split('/');
                        newParent = parts.slice(0, -1).join('/');
                        newFileName = parts[parts.length - 1];
                    } else {
                        newFilePath = fp;
                    }
                } else {
                    const fp: string = (doc as unknown as { filePath: string }).filePath;
                    const pp: string = (doc as unknown as { parentPath: string }).parentPath;
                    if (pp === oldPath || pp.startsWith(oldPath + '/')) {
                        const newPP = pp === oldPath ? newPath : `${newPath}/${pp.slice(oldPath.length + 1)}`;
                        newParent = newPP;
                        newFilePath = `${newPP}/${(doc as unknown as { fileName: string }).fileName}`;
                    } else {
                        newFilePath = fp;
                        newParent = pp;
                    }
                    newFileName = (doc as unknown as { fileName: string }).fileName;
                }
                const newArr = newKey ? newKey.split('/').filter((p: string) => p.length > 0) : (doc as unknown as { fileKeyArr: string[] }).fileKeyArr;
                await ModelS3FileIndex.updateOne({ _id: (doc as unknown as { _id: unknown })._id }, { $set: { fileKey: newKey || oldKey, fileKeyArr: newArr, filePath: newFilePath || (doc as unknown as { filePath: string }).filePath, parentPath: newParent || (doc as unknown as { parentPath: string }).parentPath, fileName: newFileName || (doc as unknown as { fileName: string }).fileName } });
            }
            const updated = await ModelS3FileIndex.findOne({ userId, bucketName, fileKey: newPrefix });
            return res.status(200).json({ success: true, file: updated ? serializeDriveFile(updated as unknown as Parameters<typeof serializeDriveFile>[0]) : null });
        } else {
            const newFileName = nameResult.normalized;
            const parentPath = fileIndex.parentPath;
            const newFilePath = parentPath ? `${parentPath}/${newFileName}` : newFileName;
            const newKey = buildS3KeyForPath(bucket, newFilePath);
            const existing = await ModelS3FileIndex.findOne({ userId, bucketName, fileKey: newKey });
            if (existing) return res.status(409).json({ message: 'A file with this name already exists' });
            await s3Client.send(new CopyObjectCommand({ Bucket: bucket.bucketName, CopySource: `${bucket.bucketName}/${fileKey}`, Key: newKey }));
            await s3Client.send(new (await import('@aws-sdk/client-s3')).DeleteObjectCommand({ Bucket: bucket.bucketName, Key: fileKey }));
            const ext = path.extname(newFileName).toLowerCase().replace('.', '') || 'unknown';
            await ModelS3FileIndex.updateOne({ _id: fileIndex._id }, { $set: { fileKey: newKey, fileKeyArr: newKey.split('/').filter((p: string) => p.length > 0), fileName: newFileName, filePath: newFilePath, fileType: ext } });
            const updated = await ModelS3FileIndex.findById(fileIndex._id);
            return res.status(200).json({ success: true, file: updated ? serializeDriveFile(updated as unknown as Parameters<typeof serializeDriveFile>[0]) : null });
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/move', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const { bucketName, fileKeys, targetPath = '' } = req.body as { bucketName: string; fileKeys: string[]; targetPath: string };
        if (!bucketName || !Array.isArray(fileKeys) || fileKeys.length === 0) return res.status(400).json({ message: 'bucketName and fileKeys are required' });
        const targetValidation = validateDriveFolderPath(targetPath);
        if (!targetValidation.valid) return res.status(400).json({ message: targetValidation.error });
        const bucket = await ModelUserS3Bucket.findOne({ userId, bucketName });
        if (!bucket) return res.status(404).json({ message: 'Bucket not found' });
        const s3Client = createS3Client(bucket);
        const results: Array<{ fileKey: string; success: boolean; message?: string }> = [];
        for (const fileKey of fileKeys) {
            const doc = await ModelS3FileIndex.findOne({ userId, bucketName, fileKey });
            if (!doc) {
                results.push({ fileKey, success: false, message: 'Not found' });
                continue;
            }
            if (doc.isFolder) {
                const oldPath: string = (doc as unknown as { filePath: string }).filePath;
                if (targetValidation.normalized === oldPath || targetValidation.normalized.startsWith(oldPath + '/')) {
                    results.push({ fileKey, success: false, message: 'Cannot move folder into itself' });
                    continue;
                }
                const folderName: string = (doc as unknown as { fileName: string }).fileName;
                const newPath = targetValidation.normalized ? `${targetValidation.normalized}/${folderName}` : folderName;
                const oldPrefix = buildS3KeyForPath(bucket, oldPath) + '/';
                const newPrefix = buildS3KeyForPath(bucket, newPath) + '/';
                const conflict = await ModelS3FileIndex.findOne({ userId, bucketName, filePath: newPath, isFolder: true });
                if (conflict) {
                    results.push({ fileKey, success: false, message: 'Target already has folder with same name' });
                    continue;
                }
                const descendants = await ModelS3FileIndex.find({ userId, bucketName, $or: [{ fileKey: { $regex: `^${oldPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } }, { fileKey: doc.fileKey }] });
                for (const d of descendants) {
                    const oldK: string = (d as unknown as { fileKey: string }).fileKey;
                    const suffix = oldK.startsWith(oldPrefix) ? oldK.slice(oldPrefix.length) : '';
                    const newK = suffix ? `${newPrefix}${suffix}` : newPrefix;
                    if (oldK !== newK) {
                        try {
                            await s3Client.send(new CopyObjectCommand({ Bucket: bucket.bucketName, CopySource: `${bucket.bucketName}/${oldK}`, Key: newK }));
                            const { DeleteObjectCommand: Del } = await import('@aws-sdk/client-s3');
                            await s3Client.send(new Del({ Bucket: bucket.bucketName, Key: oldK }));
                        } catch { /* ignore virtual markers */ }
                    }
                    const isFolderDoc = (d as unknown as { isFolder: boolean }).isFolder;
                    let newFilePath = '';
                    let newParent = '';
                    if (isFolderDoc) {
                        const fp: string = (d as unknown as { filePath: string }).filePath;
                        if (fp === oldPath) newFilePath = newPath;
                        else if (fp.startsWith(oldPath + '/')) newFilePath = `${newPath}/${fp.slice(oldPath.length + 1)}`;
                        else newFilePath = fp;
                        const parts = newFilePath.split('/');
                        newParent = parts.slice(0, -1).join('/');
                    } else {
                        const pp: string = (d as unknown as { parentPath: string }).parentPath;
                        if (pp === oldPath) newParent = newPath;
                        else if (pp.startsWith(oldPath + '/')) newParent = `${newPath}/${pp.slice(oldPath.length + 1)}`;
                        else newParent = pp;
                        const fn: string = (d as unknown as { fileName: string }).fileName;
                        newFilePath = newParent ? `${newParent}/${fn}` : fn;
                    }
                    await ModelS3FileIndex.updateOne({ _id: (d as unknown as { _id: unknown })._id }, { $set: { fileKey: newK || oldK, fileKeyArr: (newK || oldK).split('/').filter((p: string) => p.length > 0), filePath: newFilePath, parentPath: newParent } });
                }
                results.push({ fileKey, success: true });
            } else {
                const fileName: string = (doc as unknown as { fileName: string }).fileName;
                const newFilePath = targetValidation.normalized ? `${targetValidation.normalized}/${fileName}` : fileName;
                const newKey = buildS3KeyForPath(bucket, newFilePath);
                if (newKey === fileKey) {
                    results.push({ fileKey, success: false, message: 'Already in target' });
                    continue;
                }
                const existing = await ModelS3FileIndex.findOne({ userId, bucketName, fileKey: newKey });
                if (existing) {
                    results.push({ fileKey, success: false, message: 'File with same name exists in target' });
                    continue;
                }
                await s3Client.send(new CopyObjectCommand({ Bucket: bucket.bucketName, CopySource: `${bucket.bucketName}/${fileKey}`, Key: newKey }));
                await s3Client.send(new (await import('@aws-sdk/client-s3')).DeleteObjectCommand({ Bucket: bucket.bucketName, Key: fileKey }));
                await ModelS3FileIndex.updateOne({ _id: doc._id }, { $set: { fileKey: newKey, fileKeyArr: newKey.split('/').filter((p: string) => p.length > 0), filePath: newFilePath, parentPath: targetValidation.normalized } });
                results.push({ fileKey, success: true });
            }
        }
        return res.status(200).json({ success: true, results });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/copy', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const { bucketName, fileKeys, targetPath = '' } = req.body as { bucketName: string; fileKeys: string[]; targetPath: string };
        if (!bucketName || !Array.isArray(fileKeys) || fileKeys.length === 0) return res.status(400).json({ message: 'bucketName and fileKeys are required' });
        const targetValidation = validateDriveFolderPath(targetPath);
        if (!targetValidation.valid) return res.status(400).json({ message: targetValidation.error });
        const bucket = await ModelUserS3Bucket.findOne({ userId, bucketName });
        if (!bucket) return res.status(404).json({ message: 'Bucket not found' });
        const s3Client = createS3Client(bucket);
        const results: Array<{ fileKey: string; success: boolean; message?: string }> = [];
        const now = new Date();
        for (const fileKey of fileKeys) {
            const doc = await ModelS3FileIndex.findOne({ userId, bucketName, fileKey });
            if (!doc) { results.push({ fileKey, success: false, message: 'Not found' }); continue; }
            if (doc.isFolder) {
                const oldPath: string = (doc as unknown as { filePath: string }).filePath;
                const folderName: string = (doc as unknown as { fileName: string }).fileName;
                let baseName = folderName;
                let newPath = targetValidation.normalized ? `${targetValidation.normalized}/${baseName}` : baseName;
                let counter = 1;
                while (await ModelS3FileIndex.findOne({ userId, bucketName, filePath: newPath, isFolder: true })) {
                    baseName = `${folderName} (${counter})`;
                    newPath = targetValidation.normalized ? `${targetValidation.normalized}/${baseName}` : baseName;
                    counter++;
                }
                const oldPrefix = buildS3KeyForPath(bucket, oldPath) + '/';
                const newPrefix = buildS3KeyForPath(bucket, newPath) + '/';
                const descendants = await ModelS3FileIndex.find({ userId, bucketName, $or: [{ fileKey: { $regex: `^${oldPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } }, { fileKey: doc.fileKey }] });
                for (const d of descendants) {
                    const oldK: string = (d as unknown as { fileKey: string }).fileKey;
                    const suffix = oldK.startsWith(oldPrefix) ? oldK.slice(oldPrefix.length) : '';
                    const newK = suffix ? `${newPrefix}${suffix}` : newPrefix;
                    try {
                        if (!(d as unknown as { isFolder: boolean }).isFolder) {
                            await s3Client.send(new CopyObjectCommand({ Bucket: bucket.bucketName, CopySource: `${bucket.bucketName}/${oldK}`, Key: newK }));
                        } else {
                            await s3Client.send(new PutObjectCommand({ Bucket: bucket.bucketName, Key: newK, Body: Buffer.from(''), ContentType: 'application/x-directory' }));
                        }
                    } catch { /* ignore */ }
                    const isFolderDoc = (d as unknown as { isFolder: boolean }).isFolder;
                    let newFilePath = '';
                    let newParent = '';
                    if (isFolderDoc) {
                        const fp: string = (d as unknown as { filePath: string }).filePath;
                        if (fp === oldPath) newFilePath = newPath;
                        else if (fp.startsWith(oldPath + '/')) newFilePath = `${newPath}/${fp.slice(oldPath.length + 1)}`;
                        else newFilePath = fp;
                        const parts = newFilePath.split('/');
                        newParent = parts.slice(0, -1).join('/');
                    } else {
                        const pp: string = (d as unknown as { parentPath: string }).parentPath;
                        if (pp === oldPath) newParent = newPath;
                        else if (pp.startsWith(oldPath + '/')) newParent = `${newPath}/${pp.slice(oldPath.length + 1)}`;
                        else newParent = pp;
                        const fn: string = (d as unknown as { fileName: string }).fileName;
                        newFilePath = newParent ? `${newParent}/${fn}` : fn;
                    }
                    const newArr = newK.split('/').filter((p: string) => p.length > 0);
                    const srcData = d as unknown as Record<string, unknown>;
                    await ModelS3FileIndex.create({
                        userId,
                        bucketName,
                        fileKey: newK,
                        fileKeyArr: newArr,
                        filePath: newFilePath,
                        fileName: isFolderDoc ? newFilePath.split('/').pop() : srcData.fileName,
                        fileType: srcData.fileType,
                        fileSize: srcData.fileSize,
                        contentType: srcData.contentType,
                        isFolder: srcData.isFolder,
                        parentPath: newParent,
                        lastModified: now,
                        indexedAt: now,
                        textContent: (srcData.textContent as string) || '',
                        isTrashed: false,
                    });
                }
                results.push({ fileKey, success: true });
            } else {
                const fileName: string = (doc as unknown as { fileName: string }).fileName;
                let newFileName = fileName;
                let newFilePath = targetValidation.normalized ? `${targetValidation.normalized}/${newFileName}` : newFileName;
                let newKey = buildS3KeyForPath(bucket, newFilePath);
                let counter = 1;
                while (await ModelS3FileIndex.findOne({ userId, bucketName, fileKey: newKey })) {
                    const ext = path.extname(fileName);
                    const base = path.basename(fileName, ext);
                    newFileName = `${base} (${counter})${ext}`;
                    newFilePath = targetValidation.normalized ? `${targetValidation.normalized}/${newFileName}` : newFileName;
                    newKey = buildS3KeyForPath(bucket, newFilePath);
                    counter++;
                }
                await s3Client.send(new CopyObjectCommand({ Bucket: bucket.bucketName, CopySource: `${bucket.bucketName}/${fileKey}`, Key: newKey }));
                const ext = path.extname(newFileName).toLowerCase().replace('.', '') || 'unknown';
                await ModelS3FileIndex.create({
                    userId,
                    bucketName,
                    fileKey: newKey,
                    fileKeyArr: newKey.split('/').filter((p: string) => p.length > 0),
                    filePath: newFilePath,
                    fileName: newFileName,
                    fileType: ext,
                    fileSize: (doc as unknown as { fileSize: number }).fileSize,
                    contentType: (doc as unknown as { contentType: string }).contentType,
                    isFolder: false,
                    parentPath: targetValidation.normalized,
                    lastModified: now,
                    indexedAt: now,
                    textContent: (doc as unknown as { textContent: string }).textContent || '',
                    isTrashed: false,
                });
                results.push({ fileKey, success: true });
            }
        }
        return res.status(200).json({ success: true, results });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/bulk-action', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const { bucketName, action, fileKeys, targetPath = '' } = req.body as { bucketName: string; action: string; fileKeys: string[]; targetPath?: string };
        if (!bucketName || !action || !Array.isArray(fileKeys) || fileKeys.length === 0) return res.status(400).json({ message: 'bucketName, action and fileKeys are required' });
        const bucket = await ModelUserS3Bucket.findOne({ userId, bucketName });
        if (!bucket) return res.status(404).json({ message: 'Bucket not found' });
        if (action === 'delete') {
            const now = new Date();
            for (const fileKey of fileKeys) {
                const doc = await ModelS3FileIndex.findOne({ userId, bucketName, fileKey });
                if (!doc) continue;
                if (doc.isFolder) {
                    const folderPath: string = (doc as unknown as { filePath: string }).filePath;
                    const escape = folderPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    await ModelS3FileIndex.updateMany({ userId, bucketName, $or: [{ _id: doc._id }, { filePath: folderPath }, { filePath: { $regex: `^${escape}/` } }, { parentPath: folderPath }, { parentPath: { $regex: `^${escape}/` } }] }, { $set: { isTrashed: true, trashedAt: now } });
                } else {
                    await ModelS3FileIndex.updateOne({ _id: doc._id }, { $set: { isTrashed: true, trashedAt: now, originalParentPath: (doc as unknown as { parentPath: string }).parentPath } });
                }
            }
            return res.status(200).json({ success: true });
        }
        if (action === 'permanent-delete') {
            const s3Client = createS3Client(bucket);
            for (const fileKey of fileKeys) {
                const doc = await ModelS3FileIndex.findOne({ userId, bucketName, fileKey });
                if (!doc) continue;
                if (doc.isFolder) {
                    const folderPath: string = (doc as unknown as { filePath: string }).filePath;
                    const escape = folderPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    await ModelS3FileIndex.deleteMany({ userId, bucketName, $or: [{ _id: doc._id }, { filePath: folderPath }, { filePath: { $regex: `^${escape}/` } }, { parentPath: folderPath }, { parentPath: { $regex: `^${escape}/` } }] });
                } else {
                    try { await s3Client.send(new (await import('@aws-sdk/client-s3')).DeleteObjectCommand({ Bucket: bucket.bucketName, Key: fileKey })); } catch { /* ignore */ }
                    await ModelS3FileIndex.deleteOne({ _id: doc._id });
                }
            }
            return res.status(200).json({ success: true });
        }
        if (action === 'restore') {
            for (const fileKey of fileKeys) {
                await ModelS3FileIndex.updateOne({ userId, bucketName, fileKey }, { $set: { isTrashed: false, trashedAt: null } });
            }
            return res.status(200).json({ success: true });
        }
        if (action === 'move' || action === 'copy') {
            const targetValidation = validateDriveFolderPath(targetPath || '');
            if (!targetValidation.valid) return res.status(400).json({ message: targetValidation.error });
            const endpoint = action === 'move' ? '/move' : '/copy';
            return res.status(400).json({ message: `Use POST /drive${endpoint} for ${action}` });
        }
        if (action === 'download') {
            return res.status(200).json({ success: true, fileKeys });
        }
        return res.status(400).json({ message: 'Unknown action' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.get('/quota/:bucketName', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const { bucketName } = req.params;
        const bucket = await ModelUserS3Bucket.findOne({ userId, bucketName });
        if (!bucket) return res.status(404).json({ message: 'Bucket not found' });
        const agg = await ModelS3FileIndex.aggregate([
            { $match: { userId: new mongoose.Types.ObjectId(userId), bucketName, isFolder: false, isTrashed: { $ne: true } } },
            { $group: { _id: null, totalBytes: { $sum: '$fileSize' }, count: { $sum: 1 } } },
        ]);
        const totalBytes = agg[0]?.totalBytes || 0;
        const count = agg[0]?.count || 0;
        return res.status(200).json({ success: true, totalBytes, count });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.get('/trash/:bucketName', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const { bucketName } = req.params;
        const bucket = await ModelUserS3Bucket.findOne({ userId, bucketName });
        if (!bucket) return res.status(404).json({ message: 'Bucket not found' });
        const files = await ModelS3FileIndex.find({ userId, bucketName, isTrashed: true }).sort({ trashedAt: -1 }).limit(500);
        return res.status(200).json({ success: true, files: files.map(serializeDriveFile as unknown as (f: unknown) => unknown) });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/trash/restore', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const { bucketName, fileKeys } = req.body;
        if (!bucketName || !Array.isArray(fileKeys)) return res.status(400).json({ message: 'bucketName and fileKeys required' });
        await ModelS3FileIndex.updateMany({ userId, bucketName, fileKey: { $in: fileKeys } }, { $set: { isTrashed: false, trashedAt: null } });
        return res.status(200).json({ success: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/trash/empty', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const { bucketName } = req.body;
        if (!bucketName) return res.status(400).json({ message: 'bucketName required' });
        const bucket = await ModelUserS3Bucket.findOne({ userId, bucketName });
        if (!bucket) return res.status(404).json({ message: 'Bucket not found' });
        const trashed = await ModelS3FileIndex.find({ userId, bucketName, isTrashed: true });
        const s3Client = createS3Client(bucket);
        for (const doc of trashed) {
            if (!(doc as unknown as { isFolder: boolean }).isFolder) {
                try { await s3Client.send(new (await import('@aws-sdk/client-s3')).DeleteObjectCommand({ Bucket: bucket.bucketName, Key: (doc as unknown as { fileKey: string }).fileKey })); } catch { /* ignore */ }
            }
        }
        await ModelS3FileIndex.deleteMany({ userId, bucketName, isTrashed: true });
        return res.status(200).json({ success: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.get('/versions', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const bucketName = req.query.bucketName as string;
        const fileKey = req.query.fileKey as string;
        if (!bucketName || !fileKey) return res.status(400).json({ message: 'bucketName and fileKey required' });
        const doc = await ModelS3FileIndex.findOne({ userId, bucketName, fileKey });
        if (!doc) return res.status(404).json({ message: 'File not found' });
        return res.status(200).json({ success: true, versions: (doc as unknown as { versionHistory: unknown[] }).versionHistory || [] });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/share-link', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const { bucketName, fileKey, expiresInHours = 24 } = req.body;
        if (!bucketName || !fileKey) return res.status(400).json({ message: 'bucketName and fileKey required' });
        const doc = await ModelS3FileIndex.findOne({ userId, bucketName, fileKey });
        if (!doc) return res.status(404).json({ message: 'File not found' });
        const bucket = await ModelUserS3Bucket.findOne({ userId, bucketName });
        if (!bucket) return res.status(404).json({ message: 'Bucket not found' });
        const token = uuidv4().replace(/-/g, '');
        const hours = Math.min(720, Math.max(1, Number(expiresInHours) || 24));
        const expiresAt = new Date(Date.now() + hours * 3600 * 1000);
        await ModelDriveShareLink.create({ userId, bucketName, fileKey, token, expiresAt });
        const shareUrl = `/api/drive/shared/${token}`;
        return res.status(200).json({ success: true, token, shareUrl, expiresAt });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.get('/shared/:token', async (req: Request, res: Response) => {
    try {
        const { token } = req.params;
        const link = await ModelDriveShareLink.findOne({ token });
        if (!link) return res.status(404).json({ message: 'Share link not found' });
        if (link.expiresAt.getTime() < Date.now()) {
            await ModelDriveShareLink.deleteOne({ _id: link._id });
            return res.status(410).json({ message: 'Share link expired' });
        }
        const bucket = await ModelUserS3Bucket.findOne({ userId: link.userId, bucketName: link.bucketName });
        if (!bucket) return res.status(404).json({ message: 'Bucket not found' });
        const fileIndex = await ModelS3FileIndex.findOne({ userId: link.userId, bucketName: link.bucketName, fileKey: link.fileKey });
        if (!fileIndex) return res.status(404).json({ message: 'File not found' });
        const s3Client = createS3Client(bucket);
        const data = await s3Client.send(new GetObjectCommand({ Bucket: bucket.bucketName, Key: link.fileKey }));
        res.setHeader('Content-Type', (fileIndex as unknown as { contentType: string }).contentType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${(fileIndex as unknown as { fileName: string }).fileName}"`);
        if (data.ContentLength) res.setHeader('Content-Length', data.ContentLength.toString());
        (data.Body as NodeJS.ReadableStream).pipe(res);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/content-search', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const { bucketName, query, page = 1, perPage = 50 } = req.body as { bucketName: string; query: string; page?: number; perPage?: number };
        if (!bucketName || !query || !query.trim()) return res.status(400).json({ message: 'bucketName and query required' });
        const bucket = await ModelUserS3Bucket.findOne({ userId, bucketName });
        if (!bucket) return res.status(404).json({ message: 'Bucket not found' });
        const safePage = Math.max(1, Number(page) || 1);
        const safePerPage = Math.min(100, Math.max(1, Number(perPage) || 50));
        const regex = new RegExp(query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const filter = { userId, bucketName, isFolder: false, isTrashed: { $ne: true }, $or: [{ fileName: { $regex: regex } }, { textContent: { $regex: regex } }] };
        const files = await ModelS3FileIndex.find(filter).sort({ lastModified: -1 }).skip((safePage - 1) * safePerPage).limit(safePerPage);
        const totalCount = await ModelS3FileIndex.countDocuments(filter);
        return res.status(200).json({ success: true, files: files.map(serializeDriveFile as unknown as (f: unknown) => unknown), pagination: { page: safePage, perPage: safePerPage, totalCount, totalPages: Math.ceil(totalCount / safePerPage) || 1 } });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/extract-text', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const { bucketName, fileKey } = req.body;
        if (!bucketName || !fileKey) return res.status(400).json({ message: 'bucketName and fileKey required' });
        const doc = await ModelS3FileIndex.findOne({ userId, bucketName, fileKey });
        if (!doc) return res.status(404).json({ message: 'File not found' });
        const bucket = await ModelUserS3Bucket.findOne({ userId, bucketName });
        if (!bucket) return res.status(404).json({ message: 'Bucket not found' });
        const s3Client = createS3Client(bucket);
        const data = await s3Client.send(new GetObjectCommand({ Bucket: bucket.bucketName, Key: fileKey }));
        const chunks: Buffer[] = [];
        for await (const chunk of data.Body as unknown as AsyncIterable<Buffer>) { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); }
        const buffer = Buffer.concat(chunks);
        const text = await extractTextForIndex(buffer, (doc as unknown as { contentType: string }).contentType || '', (doc as unknown as { fileName: string }).fileName);
        await ModelS3FileIndex.updateOne({ _id: doc._id }, { $set: { textContent: text } });
        return res.status(200).json({ success: true, text: text.slice(0, 5000) });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;

