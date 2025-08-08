import mongoose, { Schema } from 'mongoose';
import { tsTaskListSchedule } from '../../types/typesSchema/typesSchemaTaskSchedule/SchemaTaskListSchedule.types';

const taskScheduleSchema = new Schema<tsTaskListSchedule>({
    // auth
    username: {
        type: String,
        required: true,
        default: '',
        index: true,
    },

    // required
    isActive: {
        type: Boolean,
        default: true,
    },
    shouldSendEmail: {
        type: Boolean,
        default: false,
    },
    taskType: {
        type: String,
        required: true,
        default: '',
        enum: [
            'taskAdd',
            'notesAdd',
            'customRestApiCall', // future
            'generatedDailySummaryByAi',
            'suggestDailyTasksByAi',
        ],
    },

    // required
    title: {
        type: String,
        default: '',
        trim: true,
    },
    description: {
        type: String,
        default: '',
        trim: true,
    },

    // timezone
    timezoneName: {
        type: String,
        default: 'Asia/Kolkata',
    },
    timezoneOffset: {
        type: Number,
        default: 330,
        // timezone offset in minutes
    },

    // schedule time
    scheduleTimeArr: {
        type: [Date],
        default: [],
    },

    // cron
    cronExpressionArr: {
        type: [String],
        default: [],
    },

    // schedule execution time
    scheduleExecutionTimeArr: {
        type: [Date],
        default: [],
    },
    scheduleExecutedTimeArr: {
        type: [Date],
        default: [],
    },

    // executed times
    executedTimes: {
        type: Number,
        default: 0,
    },

    // auto
    createdAtUtc: {
        type: Date,
        default: null,
    },
    createdAtIpAddress: {
        type: String,
        default: '',
    },
    createdAtUserAgent: {
        type: String,
        default: '',
    },
    updatedAtUtc: {
        type: Date,
        default: null,
    },
    updatedAtIpAddress: {
        type: String,
        default: '',
    },
    updatedAtUserAgent: {
        type: String,
        default: '',
    },
});

const ModelTaskSchedule = mongoose.model<tsTaskListSchedule>(
    'taskSchedule',
    taskScheduleSchema,
    'taskSchedules'
);

export {
    ModelTaskSchedule
};