import mongoose, { Document } from 'mongoose';

export interface tsTaskListScheduleAddTask extends Document {
    // auth
    username: string;

    // identification
    taskScheduleId: mongoose.Types.ObjectId;
    taskWorkspaceId: mongoose.Types.ObjectId;
    taskStatusId: mongoose.Types.ObjectId;

    // task fields
    taskTitle: string;
    taskDatePrefix: boolean;

    // deadline enabled
    taskDeadlineEnabled: boolean;
    taskDeadlineDays: number;

    // task ai fields
    taskAiSummary: boolean;
    taskAiContext: string;
}
