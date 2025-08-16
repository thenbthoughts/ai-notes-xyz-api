import { Document } from 'mongoose';

export interface tsTaskListScheduleUserSummaryDailyExecute extends Document {
    // auth
    username: string;

    // identification
    userDate: string;
    executeStatus: boolean;
}
