import { Router, Request, Response } from 'express';
import fileUpload from 'express-fileupload';
import path from 'path';
import mongoose from 'mongoose';
import { S3Client, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command, ListObjectsV2CommandOutput } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { PassThrough } from 'stream';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { getApiKeyByObject, tsUserApiKey } from '../../utils/llm/llmCommonFunc';
import { ModelUserFileUpload } from '../../schema/schemaUser/SchemaUserFileUpload.schema';
import IUserFileUpload from '../../types/typesSchema/typesUser/SchemaUserFileUpload.types';
import { deleteFileFromS3 } from '../../utils/drive/s3DeleteFile';
import { ModelUserApiKey } from '../../schema/schemaUser/SchemaUserApiKey.schema';
import IUserApiKey from '../../types/typesSchema/typesUser/SchemaUserApiKey.types';

// Router
const router = Router();

router.use(fileUpload({
    limits: { fileSize: 1024 * 1024 * 1024 },
}));

// Get File API
router.get(
    '/getFile',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const username = res.locals.auth_username;
            const userApiKey = getApiKeyByObject(res.locals.apiKey);

            const fileName = req.query.fileName as string;
            if (typeof fileName !== 'string') {
                return res.status(400).json({ message: 'File name must be a string' });
            }
            const fileRecord = await ModelUserFileUpload.findOne({ username, fileUploadPath: fileName });
            if (!fileRecord) {
                return res.status(404).json({ message: 'File not found for the user' });
            }

            if (!fileName) {
                return res.status(400).json({ message: 'File name is required' });
            }

            const s3Client = new S3Client({
                region: userApiKey.apiKeyS3Region,
                endpoint: userApiKey.apiKeyS3Endpoint,
                credentials: {
                    accessKeyId: userApiKey.apiKeyS3AccessKeyId,
                    secretAccessKey: userApiKey.apiKeyS3SecretAccessKey,
                },
            });

            const params = {
                Bucket: userApiKey.apiKeyS3BucketName,
                Key: fileName,
            };

            const data = await s3Client.send(new GetObjectCommand(params));
            res.setHeader('Content-Type', data.ContentType || 'application/octet-stream');
            res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
            (data.Body as NodeJS.ReadableStream).pipe(res);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Helper function to construct file path
const constructFilePath = (
    username: string,
    parentEntityId: string,
    fileName: string,
    fileExtension: string
): { filePath: string, success: boolean } => {
    let returnObj = {
        success: false,
        filePath: '',
    };

    // Construct: ai-notes-xyz/{username}/features/{parentEntityId}/{fileName}{extension}
    // Example: ai-notes-xyz/john123/features/507f1f77bcf86cd799439011/myfile.pdf
    returnObj.filePath = `ai-notes-xyz/${username}/features/${parentEntityId}/${fileName}${fileExtension}`;
    returnObj.success = true;
    return returnObj;
};

// Upload File API
router.post(
    '/uploadFile',
    middlewareUserAuth,
    async (req: Request, res: Response): Promise<Response> => {
        try {
            const username = res.locals.auth_username;
            const userApiKey = getApiKeyByObject(res.locals.apiKey);

            // Check S3 credentials
            if (!userApiKey.apiKeyS3Valid) {
                return res.status(400).json({ message: 'S3 credentials not configured' });
            }

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

            let fileRecordObj = await ModelUserFileUpload.create({
                username: username,
                fileUploadPath: `ai-notes-xyz/${username}/temp/${new Date().valueOf()}.temp`,
            }) as IUserFileUpload;

            if (!parentEntityId) {
                return res.status(400).json({
                    message: 'Missing required parameters: parentEntityId'
                });
            }

            // Validate ObjectIds
            if (!mongoose.Types.ObjectId.isValid(parentEntityId)) {
                return res.status(400).json({ message: 'Invalid parentEntityId format' });
            }

            // Get file extension from original file
            const fileExtension = path.extname(file.name);

            // Use the generated MongoDB _id as the filename
            const fileName = fileRecordObj._id.toString();

            // Construct file path
            const resultConstructFilePath = constructFilePath(
                username,
                parentEntityId,
                fileName,
                fileExtension,
            );

            // Use the constructed file path as objectKey
            const objectKey = resultConstructFilePath.filePath;

            // Content type
            const contentType = file.mimetype;

            // Create S3 client
            const s3Client = new S3Client({
                region: userApiKey.apiKeyS3Region,
                endpoint: userApiKey.apiKeyS3Endpoint,
                credentials: {
                    accessKeyId: userApiKey.apiKeyS3AccessKeyId,
                    secretAccessKey: userApiKey.apiKeyS3SecretAccessKey,
                },
            });

            // Upload to S3
            const passThroughStream = new PassThrough();
            passThroughStream.end(file.data);

            const upload = new Upload({
                client: s3Client,
                params: {
                    Bucket: userApiKey.apiKeyS3BucketName,
                    Key: objectKey,
                    ContentType: contentType,
                    Body: passThroughStream,
                },
            });

            await upload.done();

            // Store file reference in database
            const resultInsert = await ModelUserFileUpload.findOneAndUpdate(
                {
                    _id: fileRecordObj._id,
                },
                {
                    $set: {
                        fileUploadPath: objectKey,
                    },
                },
                { new: true }
            );
            console.log(resultInsert);

            return res.status(201).json({
                message: 'File uploaded successfully',
                fileName: objectKey,
                filePath: objectKey,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Delete File API
export const deleteFilesByParentEntityId = async ({
    username,
    parentEntityId,
}: {
    username: string;
    parentEntityId: string;
}): Promise<{
    success: boolean;
    error: string;
}> => {
    try {
        let userApiKey = await ModelUserApiKey.findOne({ username }) as IUserApiKey;

        if (!userApiKey) {
            return {
                success: false,
                error: 'User API key not found',
            };
        }

        let prefix = `ai-notes-xyz/${username}/features/${parentEntityId}/`;

        const s3Client = new S3Client({
            region: userApiKey.apiKeyS3Region || '',
            endpoint: userApiKey.apiKeyS3Endpoint || '',
            credentials: {
                accessKeyId: userApiKey.apiKeyS3AccessKeyId || '',
                secretAccessKey: userApiKey.apiKeyS3SecretAccessKey || '',
            },
        });

        // Find all files for this parent entity by listing from S3
        const listCommand = new ListObjectsV2Command({
            Bucket: userApiKey.apiKeyS3BucketName,
            Prefix: prefix,
        });

        const listResponse = await s3Client.send(listCommand) as ListObjectsV2CommandOutput;
        const s3Objects = listResponse.Contents || [];

        if (s3Objects.length === 0) {
            return {
                success: false,
                error: 'No files found for this entity',
            };
        }

        // Get file records from database that match the S3 paths
        const s3Keys = s3Objects.map(obj => obj.Key).filter(key => key !== undefined);
        const fileRecords = await ModelUserFileUpload.find({
            username,
            fileUploadPath: { $in: s3Keys }
        });

        // Delete each file from S3 and database
        const deletePromises = fileRecords.map(async (fileRecord) => {
            try {
                // Validate that the file path starts with the expected prefix
                if (!fileRecord.fileUploadPath.startsWith(prefix)) {
                    console.error(`File path ${fileRecord.fileUploadPath} does not match expected prefix ${prefix}`);
                    return;
                }

                const deleteCommand = new DeleteObjectCommand({
                    Bucket: userApiKey.apiKeyS3BucketName,
                    Key: fileRecord.fileUploadPath,
                });
                await s3Client.send(deleteCommand);

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
    username,
    parentEntityId,
    fileName,
}: {
    username: string;
    parentEntityId: string;
    fileName: string;
}): Promise<{
    success: boolean;
    error: string;
}> => {
    try {
        let userApiKey = await ModelUserApiKey.findOne({ username }) as IUserApiKey;
        
        if (!userApiKey) {
            return {
                success: false,
                error: 'User API key not found',
            };
        }

        // Generate the file path
        const filePath = `ai-notes-xyz/${username}/features/${parentEntityId}/${fileName}`;

        // Delete from S3
        const s3Client = new S3Client({
            region: userApiKey.apiKeyS3Region || '',
            endpoint: userApiKey.apiKeyS3Endpoint || '',
            credentials: {
                accessKeyId: userApiKey.apiKeyS3AccessKeyId || '',
                secretAccessKey: userApiKey.apiKeyS3SecretAccessKey || '',
            },
        });

        const deleteCommand = new DeleteObjectCommand({
            Bucket: userApiKey.apiKeyS3BucketName,
            Key: filePath,
        });
        await s3Client.send(deleteCommand);

        // Delete from database
        await ModelUserFileUpload.deleteOne({
            username,
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