import { Document } from 'mongoose';

// Chat Interface
export interface ILlmPendingTaskCron extends Document {
    // identification
    username: string;

    // task info
    taskType: string;
    aiModelName: string;
    aiModelProvider: string;
    targetRecordId: string | null;

    // taskOutput
    taskOutputStr: string;
    taskOutputJson: object;

    // task status
    taskStatus: 'pending' | 'success' | 'failed';
    taskRetryCount: number;
    taskStatusSuccess: string;
    taskStatusFailed: string;
    taskTimeTakenInMills: number;

    // auto
    createdAtUtc: Date | null;
    updatedAtUtc: Date | null;
};