import mongoose, { Document } from 'mongoose';

export interface tsTaskList extends Document {
    // Todo specific fields
    title: string;
    description: string;
    dueDate: Date;
    comments: string[];

    // status
    priority: '' | 'very-low' | 'low' | 'medium' | 'high' | 'very-high';
    isArchived: boolean;
    isCompleted: boolean;

    // labels
    labels: string[];
    labelsAi: string[];

    // identification
    taskWorkspaceId: mongoose.Types.ObjectId | null;
    taskStatusId: mongoose.Types.ObjectId | null;

    // task homepage pinned
    isTaskPinned: boolean;

    // reminder — relative to due date (preset keys)
    dueDateReminderPresetLabels: string[];
    /** Exact send times (ISO) configured under due-date reminders */
    dueDateReminderAbsoluteTimesIso: string[];
    /** Cron expressions configured under due-date reminders */
    dueDateReminderCronExpressions: string[];
    /** Pending / completed one-shot sends for due-date reminders */
    dueDateReminderScheduledTimes: Date[];
    dueDateReminderScheduledTimesCompleted: Date[];

    // remainder — email reminders (exact times, cron, scheduled send instants)
    remainderAbsoluteTimesIso: string[];
    remainderCronExpressions: string[];
    remainderScheduledTimes: Date[];
    remainderScheduledTimesCompleted: Date[];

    // auth
    username: string;

    // auto
    createdAtUtc: Date;
    createdAtIpAddress: string;
    createdAtUserAgent: string;
    updatedAtUtc: Date;
    updatedAtIpAddress: string;
    updatedAtUserAgent: string;
}
