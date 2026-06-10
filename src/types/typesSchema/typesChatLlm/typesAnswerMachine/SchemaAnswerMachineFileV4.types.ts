import mongoose, { Document } from 'mongoose';

export type AnswerMachineFileUploadStatusV4 = 'uploading' | 'saved_to_shell' | 'failed';

export type AnswerMachineFileRoleV4 = 'user_attachment' | 'generated';

export interface IAnswerMachineFileV4 extends Document {
    _id: mongoose.Types.ObjectId;

    answerMachineRequestV4Id: mongoose.Types.ObjectId | null;
    threadId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;

    fileName: string;
    originalSize: number;
    mimeType: string;

    /** Absolute path on shared container (from Shell write or tool output). */
    containerPath: string;
    /** Relative path accepted by Shell Engine `file/read` (from write response). */
    shellRelativePath: string;

    uploadStatus: AnswerMachineFileUploadStatusV4;
    fileRole: AnswerMachineFileRoleV4;

    /** Optional app storage key when also uploaded to user file storage (getFile). */
    storedFileUrl: string;

    createdAtUtc: Date;
}
