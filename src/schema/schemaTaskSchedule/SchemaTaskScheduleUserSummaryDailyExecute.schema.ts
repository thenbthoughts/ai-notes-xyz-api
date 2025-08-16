import mongoose, { Schema } from 'mongoose';
import { tsTaskListScheduleUserSummaryDailyExecute } from '../../types/typesSchema/typesSchemaTaskSchedule/SchemaTaskScheduleUserSummaryDailyExecute.types';

const taskScheduleUserSummaryDailyExecuteSchema = new Schema<tsTaskListScheduleUserSummaryDailyExecute>({
    // auth
    username: {
        type: String,
        required: true,
        default: '',
        index: true,
    },

    userDate: {
        type: String,
        default: '',
        index: true,
    },
    executeStatus: {
        type: Boolean,
        default: false,
    },
});

const ModelTaskScheduleUserSummaryDailyExecute = mongoose.model<tsTaskListScheduleUserSummaryDailyExecute>(
    'taskScheduleUserSummaryDailyExecute',
    taskScheduleUserSummaryDailyExecuteSchema,
    'taskScheduleUserSummaryDailyExecute'
);

export {
    ModelTaskScheduleUserSummaryDailyExecute
};