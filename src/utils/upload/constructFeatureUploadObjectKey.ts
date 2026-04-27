/**
 * GridFS filename / S3 object key for feature-thread uploads.
 * Example: ai-notes-xyz/nibf/features/{threadId}/{userFileUploadId}.jpg
 */
export function constructFeatureUploadObjectKey(
    username: string,
    parentEntityId: string,
    fileNameStem: string,
    fileExtension: string,
): string {
    return `ai-notes-xyz/${username}/features/${parentEntityId}/${fileNameStem}${fileExtension}`;
}
