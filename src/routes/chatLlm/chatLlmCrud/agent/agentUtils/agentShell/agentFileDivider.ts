/**
 * Simple file divider: split large file into chunks, process per chunk, merge.
 * Single responsibility, easy to maintain.
 */

export type DivideResult = {
    chunkPaths: string[];
    chunkCount: number;
};

export const splitFileCommand = (inputPath: string, chunkLines: number, outPrefix: string): string =>
    `split -l ${Math.max(1, chunkLines)} "${inputPath.replace(/"/g, '')}" "${outPrefix.replace(/"/g, '')}_chunk_"`;

export const mergeFilesCommand = (chunkPattern: string, outputPath: string): string =>
    `cat ${chunkPattern.replace(/"/g, '')} > "${outputPath.replace(/"/g, '')}"`;

/**
 * Decide chunk size from file size/complexity. Generic, not hardcoded per extension.
 */
export const inferChunkLines = (fileSizeBytes: number, complexity: 'low' | 'medium' | 'high' = 'medium'): number => {
    if (fileSizeBytes < 200 * 1024) return 0; // no need to divide
    if (complexity === 'low') return 5000;
    if (complexity === 'high') return 500;
    return 1000;
};
