/**
 * GridFS filename / S3 object key for feature-thread uploads.
 * Example: ai-notes-xyz/nibf/features/{threadId}/{userFileUploadId}.jpg
 */
export function constructFeatureUploadObjectKey(
    userId: string,
    parentEntityId: string,
    fileNameStem: string,
    fileExtension: string,
): string {
    return `ai-notes-xyz/${userId}/features/${parentEntityId}/${fileNameStem}${fileExtension}`;
}
