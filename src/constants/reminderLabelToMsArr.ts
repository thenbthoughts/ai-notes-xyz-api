export type ReminderLabelToMsItem = {
    labelName: string;
    labelNameStr: string;
    subTime: number;
};

export const REMINDER_LABEL_TO_MS: ReminderLabelToMsItem[] = [
    { labelName: 'before-60-day', labelNameStr: '60 days before', subTime: 60 * 24 * 60 * 60 * 1000 },
    { labelName: 'before-30-day', labelNameStr: '30 days before', subTime: 30 * 24 * 60 * 60 * 1000 },
    { labelName: 'before-15-day', labelNameStr: '15 days before', subTime: 15 * 24 * 60 * 60 * 1000 },
    { labelName: 'before-5-day', labelNameStr: '5 days before', subTime: 5 * 24 * 60 * 60 * 1000 },
    { labelName: 'before-3-day', labelNameStr: '3 days before', subTime: 3 * 24 * 60 * 60 * 1000 },
    { labelName: 'before-1-day', labelNameStr: '1 day before', subTime: 24 * 60 * 60 * 1000 },
    { labelName: 'before-6-hours', labelNameStr: '6 hours before', subTime: 6 * 60 * 60 * 1000 },
    { labelName: 'before-3-hours', labelNameStr: '3 hours before', subTime: 3 * 60 * 60 * 1000 },
    { labelName: 'before-1-hours', labelNameStr: '1 hour before', subTime: 60 * 60 * 1000 },
    { labelName: 'before-30-mins', labelNameStr: '30 minutes before', subTime: 30 * 60 * 1000 },
    { labelName: 'before-15-mins', labelNameStr: '15 minutes before', subTime: 15 * 60 * 1000 },
    { labelName: 'at-the-time-of-due-date', labelNameStr: 'At the time of due date', subTime: 0 },
].sort((a, b) => b.subTime - a.subTime);