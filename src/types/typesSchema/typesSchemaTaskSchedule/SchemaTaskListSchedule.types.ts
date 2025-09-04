import { Document } from 'mongoose';

export interface tsTaskListSchedule extends Document {
    // auth
    username: string;

    // required
    isActive: boolean;
    shouldSendEmail: boolean;
    taskType: string;
    /*
    taskType:
    - taskAdd
    - notesAdd
    - customRestApiCall
    - generatedDailySummaryByAi
    - suggestDailyTasksByAi
    - sendMyselfEmail
    */

    // required
    title: string;
    description: string;

    // schedule time
    timezoneName: string;
    timezoneOffset: number;
    scheduleTimeArr: Date[];
    cronExpressionArr: string[];
    scheduleExecutionTimeArr: Date[];
    scheduleExecutedTimeArr: Date[];
    executedTimes: number;

    // auto
    createdAtUtc: Date;
    createdAtIpAddress: string;
    createdAtUserAgent: string;
    updatedAtUtc: Date;
    updatedAtIpAddress: string;
    updatedAtUserAgent: string;
}
