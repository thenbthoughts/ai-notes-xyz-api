import mongoose from 'mongoose';
import path from 'path';
import envKeys from '../../src/config/envKeys';
import { ModelCommentCommon } from '../../src/schema/schemaCommentCommon/SchemaCommentCommon.schema';
import { ModelUserApiKey } from '../../src/schema/schemaUser/SchemaUserApiKey.schema';
import { ModelUserFileUpload } from '../../src/schema/schemaUser/SchemaUserFileUpload.schema';
import { getFile, putFile, deleteFile } from '../../src/utils/upload/uploadFunc';
import { getApiKeyByObject } from '../../src/utils/llm/llmCommonFunc';
import IUserFileUpload from '../../src/types/typesSchema/typesUser/SchemaUserFileUpload.types';

// Helper function to construct file path (same as in uploadFileS3ForFeatures.ts)
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
    returnObj.filePath = `ai-notes-xyz/${username}/features/${parentEntityId}/${fileName}${fileExtension}`;
    returnObj.success = true;
    return returnObj;
};


const migrateOldFileFormat = async () => {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(envKeys.MONGODB_URI);
        console.log('Connected to MongoDB');

        // Find all commentCommon records with old format fileUrl
        const oldFormatRecords = await ModelCommentCommon.find({
            fileUrl: { $ne: '' },
            // entityId: new mongoose.Types.ObjectId('693585d1e530582e1b875419'), // Uncomment to test with specific entity
        });
        console.log('oldFormatRecords: ', oldFormatRecords.length);
        
        // if(oldFormatRecords.length >= 1) {
        //     console.log('Too many records to process, exiting...');
        //     process.exit(0);
        // }

        console.log(`Found ${oldFormatRecords.length} records with old file format`);

        let successCount = 0;
        let errorCount = 0;
        let skippedCount = 0;

        for (const record of oldFormatRecords) {
            try {
                const oldFileUrl = record.fileUrl;
                const username = record.username;
                const parentEntityId = record.entityId?.toString() || '';

                if (parentEntityId === '') {
                    console.error(`Skipping record ${record._id} - parentEntityId is empty`);
                    errorCount++;
                    continue;
                }

                console.log(`\nProcessing record ${record._id} for user ${username}`);
                console.log(`Old fileUrl: ${oldFileUrl}`);

                // Check if old file path already matches new format (starts with ai-notes-xyz/)
                if (oldFileUrl.startsWith('ai-notes-xyz/')) {
                    console.log(`Skipping record ${record._id} - file already in new format`);
                    skippedCount++;
                    continue;
                }

                // Get user API key to determine storage type
                const userApiKeyDoc = await ModelUserApiKey.findOne({ username });
                if (!userApiKeyDoc) {
                    console.error(`User API key not found for ${username}`);
                    errorCount++;
                    continue;
                }

                const userApiKey = getApiKeyByObject(userApiKeyDoc);

                // Only process users with S3 credentials configured (storageType will always be 's3')
                if (!userApiKey.apiKeyS3Valid) {
                    console.log(`Skipping user ${username} - S3 credentials not configured`);
                    skippedCount++;
                    continue;
                }

                // Prepare S3 config
                const s3Config = {
                    region: userApiKey.apiKeyS3Region || 'auto',
                    endpoint: userApiKey.apiKeyS3Endpoint || '',
                    accessKeyId: userApiKey.apiKeyS3AccessKeyId || '',
                    secretAccessKey: userApiKey.apiKeyS3SecretAccessKey || '',
                    bucketName: userApiKey.apiKeyS3BucketName || '',
                };

                console.log('s3Config: ', s3Config);

                // Download old file from S3
                console.log(`Downloading old file from S3: ${oldFileUrl}`);
                const fileData = await getFile({
                    fileName: oldFileUrl,
                    storageType: 's3',
                    s3Config,
                });

                if (!fileData.success || !fileData.content) {
                    console.error(`Failed to download file: ${fileData.error}`);
                    errorCount++;
                    continue;
                }

                console.log(`File downloaded successfully (${fileData.content.length} bytes)`);

                // Get file extension from old filename
                const fileExtension = path.extname(oldFileUrl) || '.jpg'; // Default to .jpg if no extension

                // Create temporary file record first (same pattern as uploadFileS3ForFeatures.ts)
                let fileRecordObj = await ModelUserFileUpload.create({
                    username: username,
                    fileUploadPath: `ai-notes-xyz/${username}/temp/${new Date().valueOf()}.temp`,
                    storageType: 's3',
                }) as IUserFileUpload;

                // Use the generated MongoDB _id as the filename
                const fileName = fileRecordObj._id.toString();

                // Construct new file path
                const resultConstructFilePath = constructFilePath(
                    username,
                    parentEntityId,
                    fileName,
                    fileExtension,
                );

                const objectKey = resultConstructFilePath.filePath;
                console.log(`New file path: ${objectKey}`);

                // Upload to S3 (new location)
                console.log(`Uploading to S3 (new location)...`);
                const uploadResult = await putFile({
                    fileName: objectKey,
                    fileContent: fileData.content,
                    contentType: fileData.contentType || 'image/jpeg',
                    metadata: {
                        username,
                        parentEntityId,
                        originalName: path.basename(oldFileUrl),
                    },
                    storageType: 's3',
                    s3Config,
                });

                if (!uploadResult.success) {
                    // Clean up record on failure
                    await ModelUserFileUpload.deleteOne({ _id: fileRecordObj._id });
                    console.error(`Upload failed: ${uploadResult.error}`);
                    errorCount++;
                    continue;
                }

                console.log(`File uploaded successfully to S3`);

                // Update file record in database
                const updateData: any = {
                    fileUploadPath: objectKey,
                    storageType: 's3',
                    parentEntityId: parentEntityId,
                    contentType: fileData.contentType || 'image/jpeg',
                    originalName: path.basename(oldFileUrl),
                    size: fileData.content.length,
                };

                await ModelUserFileUpload.findOneAndUpdate(
                    { _id: fileRecordObj._id },
                    { $set: updateData },
                    { new: true }
                );

                // Update commentCommon record with new fileUrl
                await ModelCommentCommon.updateOne(
                    { _id: record._id },
                    { $set: { fileUrl: objectKey } }
                );

                console.log(`Updated commentCommon record with new fileUrl`);

                // Delete old file from S3
                console.log(`Deleting old file from S3...`);
                const deleteResult = await deleteFile({
                    fileName: oldFileUrl,
                    storageType: 's3',
                    s3Config,
                });
                if (!deleteResult.success) {
                    console.warn(`Warning: Failed to delete old file: ${deleteResult.error}`);
                    // Continue anyway since migration is successful
                } else {
                    console.log(`Old file deleted successfully`);
                }

                successCount++;
                console.log(`✓ Successfully migrated record ${record._id}`);

            } catch (error) {
                console.error(`Error processing record ${record._id}:`, error);
                errorCount++;
            }
        }

        console.log(`\n=== Migration Summary ===`);
        console.log(`Total records found: ${oldFormatRecords.length}`);
        console.log(`Successful migrations (S3): ${successCount}`);
        console.log(`Skipped (no S3 config): ${skippedCount}`);
        console.log(`Failed migrations: ${errorCount}`);

    } catch (error) {
        console.error('Migration error:', error);
    } finally {
        console.log('Closing MongoDB connection...');
        await mongoose.disconnect();
        console.log('Migration completed');
    }
};

migrateOldFileFormat();

// npx ts-node -r dotenv/config ./srcTest/migrations/migrateOldFileFormatForComments.ts