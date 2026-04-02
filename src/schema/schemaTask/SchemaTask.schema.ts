import mongoose, { Schema } from 'mongoose';
import { tsTaskList } from '../../types/typesSchema/typesSchemaTask/SchemaTaskList2.types';

const taskSchema = new Schema<tsTaskList>({
    // Task specific fields
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
    //
    priority: {
        type: String,
        default: '',
        enum: ['', 'very-low', 'low', 'medium', 'high', 'very-high']
    },
    dueDate: {
        type: Date,
        default: null,
    },

    // identification
    taskWorkspaceId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
    },
    taskStatusId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
    },

    // status
    isArchived: {
        type: Boolean,
        default: false,
    },
    isCompleted: {
        type: Boolean,
        default: false,
    },

    labels: {
        type: [String],
        default: [],
    },
    labelsAi: {
        type: [String],
        default: [],
    },

    // auth
    username: {
        type: String,
        required: true,
        default: '',
        index: true,
    },

    // task homepage pinned
    isTaskPinned: {
        type: Boolean,
        default: false,
    },

    // due date reminder
    dueDateReminderPresetLabels: {
        type: [String],
        default: [],
        // here we will store the preset labels for the reminders
    },
    dueDateReminderAbsoluteTimesIso: {
        type: [String],
        default: [],
        // here we will store the absolute times for the reminders
    },
    dueDateReminderCronExpressions: {
        type: [String],
        default: [],
        // here we will store the cron expressions for the reminders
    },
    dueDateReminderScheduledTimes: {
        type: [Date],
        default: [],
        // here we will store the times when the reminder was scheduled to be sent
    },
    dueDateReminderScheduledTimesCompleted: {
        type: [Date],
        default: [],
        // here we will store the times when the reminder was sent
    },

    // reminder
    remainderAbsoluteTimesIso: {
        type: [String],
        default: [],
        // here we will store the absolute times for the reminders
    },
    remainderCronExpressions: {
        type: [String],
        default: [],
        // here we will store the cron expressions for the reminders
    },
    remainderScheduledTimes: {
        type: [Date],
        default: [],
        // here we will store the times when the reminder was scheduled to be sent
    },
    remainderScheduledTimesCompleted: {
        type: [Date],
        default: [],
        // here we will store the times when the reminder was sent
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

const ModelTask = mongoose.model<tsTaskList>(
    'tasks',
    taskSchema,
    'tasks'
);

export {
    ModelTask
};