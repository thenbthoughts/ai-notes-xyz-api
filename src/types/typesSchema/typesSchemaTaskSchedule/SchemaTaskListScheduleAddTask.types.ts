import mongoose, { Document } from 'mongoose';

export interface tsTaskListScheduleAddTask extends Document {
    // auth
    username: string;

    // identification
    taskScheduleId: mongoose.Types.ObjectId;
    taskWorkspaceId: mongoose.Types.ObjectId;
    taskStatusId: mongoose.Types.ObjectId;

    taskTitle: string;
    taskDatePrefix: boolean;
    taskDeadline: string;
    taskAiSummary: boolean;
    taskAiContext: string;
}
