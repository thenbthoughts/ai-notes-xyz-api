import mongoose from 'mongoose';

import type { ChatShellExecuteStrategy } from './SchemaChatShellRunTodo.types';

/** One row in `shellRunArtifactV1.todos` (embedded on chatLlm shell-run message). */
export interface IShellRunArtifactV1Todo {
    orderIndex: number;
    taskName: string;
    executeStrategyBy: ChatShellExecuteStrategy;
    shellCommand: string;
    verifyShellCommand?: string;
    attemptCount?: number;
    status: string;
    exitCode: number | null;
    verifyExitCode?: number | null;
    stdoutPreview: string;
    stderrPreview: string;
}

/** One row in `shellRunArtifactV1.importedFiles`. */
export interface IShellRunArtifactV1ImportedFile {
    fileName: string;
    mimeType: string;
    storedFileUrl: string;
    relativePath: string;
    summaryPreview: string;
}

/** Persisted subdocument on `chatLlm` for `tags` containing `shell-run`. */
export interface IShellRunArtifactV1 {
    version: number;
    kind: 'shell_run';
    chatShellRunGroupId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    username: string;
    completedAtUtc: Date;
    todos: IShellRunArtifactV1Todo[];
    importedFiles: IShellRunArtifactV1ImportedFile[];
}

/** Plain shape before mapping ObjectIds / Date for Mongo. */
export interface IShellRunArtifactV1Plain {
    version: 1;
    kind: 'shell_run';
    chatShellRunGroupId: string;
    threadId: string;
    username: string;
    completedAtUtc: string;
    todos: IShellRunArtifactV1Todo[];
    importedFiles: IShellRunArtifactV1ImportedFile[];
}
