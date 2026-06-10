import { Document, Types } from 'mongoose';

export interface tsTaskListScheduleUserSummaryDailyExecute extends Document {
    // auth
    userId: Types.ObjectId;

    // identification
    userDate: string;
    executeStatus: boolean;
}
