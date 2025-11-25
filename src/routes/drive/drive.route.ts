import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelUserS3Bucket } from '../../schema/schemaDrive/SchemaUserS3Bucket.schema';
import { ModelS3FileIndex } from '../../schema/schemaDrive/SchemaS3FileIndex.schema';
import { indexFilesFromS3 } from '../../utils/drive/s3IndexFiles';
import { deleteFileFromS3 } from '../../utils/drive/s3DeleteFile';
import { createS3Client } from '../../utils/drive/s3ListFiles';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const router = Router();

// Get user's S3 buckets
router.get('/buckets', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const username = res.locals.auth_username;
        
        const buckets = await ModelUserS3Bucket.find({ username }).sort({ createdAtUtc: -1 });
        
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
        const username = res.locals.auth_username;
        const { bucketName, endpoint, region, accessKeyId, secretAccessKey, prefix } = req.body;
        
        if (!bucketName || !endpoint || !region || !accessKeyId || !secretAccessKey) {
            return res.status(400).json({ message: 'Missing required fields' });
        }
        
        const bucket = await ModelUserS3Bucket.create({
            username,
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
        const username = res.locals.auth_username;
        const { id } = req.params;
        const { bucketName, endpoint, region, accessKeyId, secretAccessKey, prefix, isActive } = req.body;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid bucket ID' });
        }
        
        const bucket = await ModelUserS3Bucket.findOne({ _id: id, username });
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
        
        await ModelUserS3Bucket.updateOne({ _id: id, username }, updateData);
        
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
        const username = res.locals.auth_username;
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid bucket ID' });
        }
        
        const bucket = await ModelUserS3Bucket.findOne({ _id: id, username });
        if (!bucket) {
            return res.status(404).json({ message: 'Bucket not found' });
        }
        
        // Delete all indexed files for this bucket
        await ModelS3FileIndex.deleteMany({ username, bucketName: bucket.bucketName });
        
        // Delete the bucket
        await ModelUserS3Bucket.deleteOne({ _id: id, username });
        
        return res.status(200).json({ success: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Reindex files for a bucket
router.post('/index/:bucketName', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const username = res.locals.auth_username;
        const { bucketName } = req.params;
        const { prefix } = req.body;
        
        const bucket = await ModelUserS3Bucket.findOne({ username, bucketName });
        if (!bucket) {
            return res.status(404).json({ message: 'Bucket not found' });
        }
        
        const result = await indexFilesFromS3({
            bucket,
            username,
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

// List files/folders
router.post('/files', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const username = res.locals.auth_username;
        const { bucketName, parentPath = '', page = 1, perPage = 10000 } = req.body;
        
        if (!bucketName) {
            return res.status(400).json({ message: 'bucketName is required' });
        }
        
        // Get bucket to know its prefix
        const bucket = await ModelUserS3Bucket.findOne({ username, bucketName });
        if (!bucket) {
            return res.status(404).json({ message: 'Bucket not found' });
        }
        
        // Use parentPath for querying - it's simpler and more reliable
        // parentPath is already calculated correctly during indexing
        const query: any = {
            username,
            bucketName,
            parentPath: parentPath || '',
        };
        
        const skip = (page - 1) * perPage;
        
        // Sort: folders first (isFolder: true = 1, false = 0, so -1 means descending = folders first)
        // Then sort by fileName alphabetically
        const files = await ModelS3FileIndex.find(query)
            .sort({ 
                isFolder: -1,  // Folders first (true comes before false)
                fileName: 1   // Then alphabetical by name
            })
            .skip(skip)
            .limit(perPage);
        
        const totalCount = await ModelS3FileIndex.countDocuments(query);
        
        return res.status(200).json({
            success: true,
            files: files.map(file => ({
                _id: file._id,
                fileKey: file.fileKey,
                fileKeyArr: file.fileKeyArr || [],
                filePath: file.filePath,
                fileName: file.fileName,
                fileType: file.fileType,
                fileSize: file.fileSize,
                contentType: file.contentType,
                isFolder: file.isFolder,
                parentPath: file.parentPath,
                lastModified: file.lastModified,
                indexedAt: file.indexedAt,
            })),
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

// Get file content
router.get('/file', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const username = res.locals.auth_username;
        const bucketName = req.query.bucketName as string;
        const fileKey = req.query.fileKey as string;
        
        if (!bucketName || !fileKey) {
            return res.status(400).json({ message: 'bucketName and fileKey are required' });
        }
        
        // Verify file belongs to user
        const fileIndex = await ModelS3FileIndex.findOne({ username, bucketName, fileKey });
        if (!fileIndex) {
            return res.status(404).json({ message: 'File not found' });
        }
        
        const bucket = await ModelUserS3Bucket.findOne({ username, bucketName });
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
        const username = res.locals.auth_username;
        const { bucketName, fileKey, content } = req.body;
        
        if (!bucketName || !fileKey || content === undefined) {
            return res.status(400).json({ message: 'bucketName, fileKey, and content are required' });
        }
        
        // Verify file belongs to user
        const fileIndex = await ModelS3FileIndex.findOne({ username, bucketName, fileKey });
        if (!fileIndex) {
            return res.status(404).json({ message: 'File not found' });
        }
        
        if (fileIndex.isFolder) {
            return res.status(400).json({ message: 'Cannot edit folder' });
        }
        
        const bucket = await ModelUserS3Bucket.findOne({ username, bucketName });
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

// Delete file
router.delete('/file', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const username = res.locals.auth_username;
        const bucketName = req.query.bucketName as string;
        const fileKey = req.query.fileKey as string;
        
        if (!bucketName || !fileKey) {
            return res.status(400).json({ message: 'bucketName and fileKey are required' });
        }
        
        // Verify file belongs to user
        const fileIndex = await ModelS3FileIndex.findOne({ username, bucketName, fileKey });
        if (!fileIndex) {
            return res.status(404).json({ message: 'File not found' });
        }
        
        const bucket = await ModelUserS3Bucket.findOne({ username, bucketName });
        if (!bucket) {
            return res.status(404).json({ message: 'Bucket not found' });
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

