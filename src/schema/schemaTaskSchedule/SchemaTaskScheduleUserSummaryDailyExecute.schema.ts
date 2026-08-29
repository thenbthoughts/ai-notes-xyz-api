import mongoose, { Schema } from 'mongoose';
import { tsTaskListScheduleUserSummaryDailyExecute } from '../../types/typesSchema/typesSchemaTaskSchedule/SchemaTaskScheduleUserSummaryDailyExecute.types';

const taskScheduleUserSummaryDailyExecuteSchema = new Schema<tsTaskListScheduleUserSummaryDailyExecute>({
    // auth
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'user',
        required: true,
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