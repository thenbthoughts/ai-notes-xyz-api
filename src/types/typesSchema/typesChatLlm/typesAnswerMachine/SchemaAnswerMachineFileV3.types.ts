import mongoose, { Document } from 'mongoose';

export type AnswerMachineFileTypeV3 = 'user_upload' | 'generated';

/** Describes why the artifact exists (free-form classification for UX and prompts). */
export type AnswerMachineFilePurposeV3 =
    | 'image_rotation'
    | 'data_analysis'
    | 'graph_generation'
    | 'shell_generated'
    | 'user_attachment'
    | 'other';

export interface IAnswerMachineFileV3 extends Document {
    _id: mongoose.Types.ObjectId;

    answerMachineRequestV3Id: mongoose.Types.ObjectId;
    answerMachineIteration: number | null;
    answerMachineSubQuestionV3Id: mongoose.Types.ObjectId | null;

    threadId: mongoose.Types.ObjectId;
    username: string;

    fileType: AnswerMachineFileTypeV3;
    purpose: AnswerMachineFilePurposeV3;

    storedFileUrl: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;

    /** Workspace path when produced by shell (informational). */
    relativeShellPath: string;

    description: string;
    metadata: Record<string, unknown>;

    createdAtUtc: Date;
}
