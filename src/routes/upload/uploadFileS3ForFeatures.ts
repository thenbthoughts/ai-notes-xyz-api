import { Router, Request, Response } from 'express';
import fileUpload from 'express-fileupload';
import path from 'path';
import mongoose from 'mongoose';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { PassThrough } from 'stream';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { getApiKeyByObject } from '../../utils/llm/llmCommonFunc';
import { ModelUserFileUpload } from '../../schema/schemaUser/SchemaUserFileUpload.schema';
import IUserFileUpload from '../../types/typesSchema/typesUser/SchemaUserFileUpload.types';

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

// Valid feature types
const VALID_FEATURE_TYPES = ['chat', 'task', 'notes', 'lifeevent', 'infovault'] as const;
type FeatureType = typeof VALID_FEATURE_TYPES[number];

// Valid sub-types (same for all features)
const VALID_SUB_TYPES = ['messages', 'comments'] as const;
type SubType = typeof VALID_SUB_TYPES[number];

// Helper function to construct file path
const constructFilePath = (
    username: string,
    featureType: FeatureType,
    parentEntityId: string,
    subType: SubType,
    subEntityId: string,
    fileExtension: string
): { filePath: string, success: boolean } => {
    let returnObj = {
        success: false,
        filePath: '',
    };

    // Get feature prefix for main record ID and sub-id prefix based on feature type and sub-type
    let featurePrefix: string = '';
    let subIdPrefix: string = '';

    if (featureType === 'chat') {
        featurePrefix = 'chat-thread-';
        if (subType === 'messages') {
            subIdPrefix = 'chat-';
        } else if (subType === 'comments') {
            subIdPrefix = 'chatcomment-';
        }
    } else if (featureType === 'task') {
        featurePrefix = 'task-';
        subIdPrefix = 'taskcomment-';
    } else if (featureType === 'notes') {
        featurePrefix = 'note-';
        subIdPrefix = 'notecomments-';
    } else if (featureType === 'lifeevent') {
        featurePrefix = 'lifeevent-';
        subIdPrefix = 'lifeeventcomment-';
    } else if (featureType === 'infovault') {
        featurePrefix = 'infovault-';
        subIdPrefix = 'vaultcomment-';
    }

    if (featurePrefix === '') {
        returnObj.success = false;
        returnObj.filePath = '';
        return returnObj;
    }
    if (subIdPrefix === '') {
        returnObj.success = false;
        returnObj.filePath = '';
        return returnObj;
    }
    // Construct: ai-notes-xyz/{username}/{featureType}/{featurePrefix}{parentEntityId}/{subType}/{subIdPrefix}{subEntityId}{extension}
    // Example: ai-notes-xyz/john123/chat/chat-thread-507f1f77bcf86cd799439011/messages/chat-507f191e810c19729de860ea.pdf
    returnObj.filePath = `ai-notes-xyz/${username}/${featureType}/${featurePrefix}${parentEntityId}/${subType}/${subIdPrefix}${subEntityId}${fileExtension}`;
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
            const { featureType, parentEntityId, subType } = req.body;

            let fileRecordObj = await ModelUserFileUpload.create({
                username: username,
                fileUploadPath: `ai-notes-xyz/${username}/temp/${new Date().valueOf()}.temp`,
            }) as IUserFileUpload;

            if (!featureType || !parentEntityId || !subType) {
                return res.status(400).json({
                    message: 'Missing required parameters: featureType, parentEntityId, subType, subEntityId'
                });
            }

            // Validate feature type
            if (!VALID_FEATURE_TYPES.includes(featureType as FeatureType)) {
                return res.status(400).json({
                    message: `Invalid featureType. Must be one of: ${VALID_FEATURE_TYPES.join(', ')}`
                });
            }

            // Validate sub-type
            if (!VALID_SUB_TYPES.includes(subType as SubType)) {
                return res.status(400).json({
                    message: `Invalid subType. Must be one of: ${VALID_SUB_TYPES.join(', ')}`
                });
            }

            // Validate ObjectIds
            if (!mongoose.Types.ObjectId.isValid(parentEntityId)) {
                return res.status(400).json({ message: 'Invalid parentEntityId format' });
            }

            // Get file extension from original file
            const fileExtension = path.extname(file.name);

            // Construct file path using subEntityId with prefix (not MongoDB _id)
            // The filename format is: {prefix}{subEntityId}.ext
            // Example: chat-507f191e810c19729de860ea.pdf
            const resultConstructFilePath = constructFilePath(
                username,
                featureType as FeatureType,
                parentEntityId,
                subType as SubType,
                fileRecordObj._id.toString(),
                fileExtension
            );

            if (!resultConstructFilePath.success) {
                return res.status(400).json({ message: 'Failed to construct file path for the file upload' });
            }
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

            // Store file reference in database with the generated MongoDB _id
            // The _id is used for the database record, but the filename uses subEntityId
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

export default router;

