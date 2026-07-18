const FILE_TYPE_FILTER_OPTIONS: Record<string, string[]> = {
    image: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'],
    video: ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv'],
    audio: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'],
    pdf: ['pdf'],
    document: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf'],
    code: ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'cs', 'php', 'rb', 'go', 'rs'],
    archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'],
    markdown: ['md', 'markdown'],
};

export const mapFileTypeFiltersToExtensions = (fileTypes: string[]): string[] => {
    const extensions = new Set<string>();
    for (const type of fileTypes) {
        const list = FILE_TYPE_FILTER_OPTIONS[type];
        if (list) {
            list.forEach((ext) => extensions.add(ext));
        }
    }
    return Array.from(extensions);
};

export const serializeDriveFile = (file: {
    _id: unknown;
    fileKey: string;
    fileKeyArr?: string[];
    filePath: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    contentType?: string;
    isFolder: boolean;
    parentPath: string;
    lastModified?: Date | null;
    indexedAt: Date;
}) => ({
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
});
