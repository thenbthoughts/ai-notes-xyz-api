import path from 'path';
import { ModelS3FileIndex } from '../../schema/schemaDrive/SchemaS3FileIndex.schema';
import IUserS3Bucket from '../../types/typesSchema/typesDrive/SchemaUserS3Bucket.types';
import { serializeDriveFile } from './driveApiHelpers';

/**
 * Build S3 key and relative path fields for a new file under parentPath.
 */
export const buildDriveFileLocation = ({
    bucket,
    parentPath,
    fileName,
}: {
    bucket: IUserS3Bucket;
    parentPath: string;
    fileName: string;
}): {
    fileKey: string;
    fileKeyArr: string[];
    filePath: string;
    fileName: string;
    parentPath: string;
    fileType: string;
} => {
    const bucketPrefixArr = bucket.prefix
        ? bucket.prefix.split('/').filter((p: string) => p)
        : [];
    const parentSegments = parentPath
        ? parentPath.split('/').filter((p) => p.length > 0)
        : [];
    const relativeSegments = [...parentSegments, fileName];
    const fileKeyArr = [...bucketPrefixArr, ...relativeSegments];
    const fileKey = fileKeyArr.join('/');
    const filePath = relativeSegments.join('/');
    const ext = path.extname(fileName).toLowerCase().replace('.', '') || 'unknown';

    return {
        fileKey,
        fileKeyArr,
        filePath,
        fileName,
        parentPath: parentSegments.join('/'),
        fileType: ext,
    };
};

/**
 * Upsert file index row and all ancestor folder rows (same conventions as s3IndexFiles).
 */
export const upsertDriveFileIndex = async ({
    userId,
    bucket,
    parentPath,
    fileName,
    fileSize,
    contentType,
}: {
    userId: string;
    bucket: IUserS3Bucket;
    parentPath: string;
    fileName: string;
    fileSize: number;
    contentType: string;
}) => {
    const location = buildDriveFileLocation({ bucket, parentPath, fileName });
    const now = new Date();
    const bucketPrefixArr = bucket.prefix
        ? bucket.prefix.split('/').filter((p: string) => p)
        : [];
    const relativeSegments = location.filePath.split('/').filter((p) => p.length > 0);

    // Ancestor folders
    for (let i = 1; i < relativeSegments.length; i++) {
        const folderSegments = relativeSegments.slice(0, i);
        const folderPath = folderSegments.join('/');
        const folderName = folderSegments[i - 1];
        const folderS3Key =
            bucketPrefixArr.length > 0
                ? [...bucketPrefixArr, ...folderSegments].join('/') + '/'
                : folderSegments.join('/') + '/';

        await ModelS3FileIndex.findOneAndUpdate(
            {
                userId,
                bucketName: bucket.bucketName,
                fileKey: folderS3Key,
            },
            {
                userId,
                bucketName: bucket.bucketName,
                fileKey: folderS3Key,
                fileKeyArr: folderS3Key.split('/').filter((part: string) => part.length > 0),
                filePath: folderPath,
                fileName: folderName,
                fileType: 'folder',
                fileSize: 0,
                contentType: '',
                isFolder: true,
                parentPath: i > 1 ? folderSegments.slice(0, i - 1).join('/') : '',
                lastModified: now,
                indexedAt: now,
            },
            { upsert: true, new: true }
        );
    }

    const fileDoc = await ModelS3FileIndex.findOneAndUpdate(
        {
            userId,
            bucketName: bucket.bucketName,
            fileKey: location.fileKey,
        },
        {
            userId,
            bucketName: bucket.bucketName,
            fileKey: location.fileKey,
            fileKeyArr: location.fileKeyArr,
            filePath: location.filePath,
            fileName: location.fileName,
            fileType: location.fileType,
            fileSize,
            contentType,
            isFolder: false,
            parentPath: location.parentPath,
            lastModified: now,
            indexedAt: now,
        },
        { upsert: true, new: true }
    );

    return {
        location,
        file: serializeDriveFile(fileDoc!),
    };
};
