import { Router, Request, Response } from 'express';
import fileUpload from 'express-fileupload';
import { DateTime } from 'luxon';
import path from 'path';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { PassThrough } from 'stream';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { getApiKeyByObject } from '../../utils/llm/llmCommonFunc';
import { ModelUserFileUpload } from '../../schema/schemaUser/SchemaUserFileUpload.schema';

// Router
const router = Router();

router.use(fileUpload({
    limits: { fileSize: 1024 * 1024 * 1024 },
}));

// Upload File API
router.post(
    '/uploadFile',
    middlewareUserAuth,
    async (req: Request, res: Response): Promise<Response> => {
        try {
            const username = res.locals.auth_username;

            const userApiKey = getApiKeyByObject(res.locals.apiKey);

            if (!req.files || Object.keys(req.files).length === 0) {
                return res.status(400).json({ message: 'No file uploaded' });
            }

            const file = req.files.file as fileUpload.UploadedFile;
            if (Array.isArray(file)) {
                return res.status(400).json({ message: 'Only one file can be uploaded at a time' });
            }

            // utc time
            const dtUtc = DateTime.utc();
            const utc = dtUtc.toFormat('yyyy-MM-dd').toString();

            // filename
            // const timestamp = new Date().valueOf().toString();
            const randomNumberFile = Math.floor(
                Math.random() * 1_000_000_000
            )
            const fileName = dtUtc.valueOf() + '-' + randomNumberFile + path.extname(file.name);

            // file path
            const objectKey = `userUpload/chat/${utc}/${fileName}`;

            // content type
            const contentType = file.mimetype;

            const s3Client = new S3Client({
                region: userApiKey.apiKeyS3Region,
                endpoint: userApiKey.apiKeyS3Endpoint,
                credentials: {
                    accessKeyId: userApiKey.apiKeyS3AccessKeyId,
                    secretAccessKey: userApiKey.apiKeyS3SecretAccessKey,
                },
            });

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

            // add to file upload
            const resultInsert = await ModelUserFileUpload.create({
                username: username,
                fileUploadPath: objectKey,
            });
            console.log(resultInsert);

            return res.status(201).json({
                message: 'File uploaded successfully',
                fileName: objectKey
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

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

export default router;