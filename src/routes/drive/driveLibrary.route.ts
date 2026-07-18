import { Router, Request, Response } from 'express';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelUserS3Bucket } from '../../schema/schemaDrive/SchemaUserS3Bucket.schema';
import { ModelS3FileIndex } from '../../schema/schemaDrive/SchemaS3FileIndex.schema';
import {
    mapFileTypeFiltersToExtensions,
    serializeDriveFile,
} from '../../utils/drive/driveApiHelpers';

const router = Router();

// Flat file library with filters and pagination
router.post('/', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const {
            bucketName,
            page = 1,
            perPage = 50,
            search = '',
            fileTypes = [],
            sortBy = 'name',
            sortOrder = 'asc',
        } = req.body as {
            bucketName?: string;
            page?: number;
            perPage?: number;
            search?: string;
            fileTypes?: string[];
            sortBy?: 'name' | 'size' | 'date';
            sortOrder?: 'asc' | 'desc';
        };

        if (!bucketName) {
            return res.status(400).json({ message: 'bucketName is required' });
        }

        const bucket = await ModelUserS3Bucket.findOne({ userId, bucketName });
        if (!bucket) {
            return res.status(404).json({ message: 'Bucket not found' });
        }

        const safePage = Math.max(1, Number(page) || 1);
        const safePerPage = Math.min(200, Math.max(1, Number(perPage) || 50));
        const skip = (safePage - 1) * safePerPage;

        const query: Record<string, unknown> = {
            userId,
            bucketName,
            isFolder: false,
        };

        if (search.trim()) {
            query.fileName = { $regex: search.trim(), $options: 'i' };
        }

        if (Array.isArray(fileTypes) && fileTypes.length > 0) {
            const extensions = mapFileTypeFiltersToExtensions(fileTypes);
            if (extensions.length > 0) {
                query.fileType = { $in: extensions };
            }
        }

        const sortField =
            sortBy === 'size' ? 'fileSize' : sortBy === 'date' ? 'lastModified' : 'fileName';
        const sortDirection = sortOrder === 'desc' ? -1 : 1;

        const files = await ModelS3FileIndex.find(query)
            .sort({ [sortField]: sortDirection, fileName: 1 })
            .skip(skip)
            .limit(safePerPage);

        const totalCount = await ModelS3FileIndex.countDocuments(query);

        return res.status(200).json({
            success: true,
            files: files.map(serializeDriveFile),
            pagination: {
                page: safePage,
                perPage: safePerPage,
                totalCount,
                totalPages: Math.ceil(totalCount / safePerPage) || 1,
            },
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;
