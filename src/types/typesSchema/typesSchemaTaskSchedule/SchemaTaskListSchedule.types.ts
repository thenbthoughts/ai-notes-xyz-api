import { Document, Types } from 'mongoose';

export interface tsTaskListSchedule extends Document {
    _id: Types.ObjectId;
    // auth
    userId: Types.ObjectId;

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
    dueDate: Date | null;
    dueDateReminderPresetLabels: string[];
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
