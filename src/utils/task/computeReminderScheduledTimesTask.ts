import mongoose from 'mongoose';
import { ModelTask } from '../../schema/schemaTask/SchemaTask.schema';
import { tsTaskList } from '../../types/typesSchema/typesSchemaTask/SchemaTaskList2.types';
import { computeRemainderScheduledTimesFromInput } from './computeRemainderScheduledTimesInput';

/** Drop instants that were already emailed (same UTC ms as an entry in *Completed). */
function filterInstantsNotInCompleted(instants: Date[], completed: Date[] | undefined | null): Date[] {
    if (!completed?.length) return instants;
    const done = new Set<number>();
    for (const c of completed) {
        const t = new Date(c).getTime();
        if (!Number.isNaN(t)) done.add(t);
    }
    return instants.filter((d) => {
        const t = new Date(d).getTime();
        return !Number.isNaN(t) && !done.has(t);
    });
}

export const computeReminderScheduledTimes = async ({
    taskId,
    cronTimeZone,
}: {
    taskId: mongoose.Types.ObjectId;
    cronTimeZone: string;
}) => {
    try {
        const task = (await ModelTask.findOne({
            _id: taskId,
        }).lean()) as tsTaskList | null;

        if (!task) {
            return false;
        }

        const dueReminder = computeRemainderScheduledTimesFromInput({
            cronExpressions: (task.dueDateReminderCronExpressions as string[]) || [],
            cronTimeZone: cronTimeZone,
            absoluteTimesIso: (task.dueDateReminderAbsoluteTimesIso as string[]) || [],
            presetLabels: (task.dueDateReminderPresetLabels as string[]) || [],
            dueDate: task.dueDate ? new Date(task.dueDate as string | Date) : null,
        });

        const remainderReminder = computeRemainderScheduledTimesFromInput({
            cronExpressions: (task.remainderCronExpressions as string[]) || [],
            cronTimeZone: cronTimeZone,
            absoluteTimesIso: (task.remainderAbsoluteTimesIso as string[]) || [],
            presetLabels: [],
            dueDate: null,
        });

        const dueFiltered = filterInstantsNotInCompleted(
            dueReminder.remainderScheduledTimes,
            task.dueDateReminderScheduledTimesCompleted as Date[] | undefined
        );
        const remFiltered = filterInstantsNotInCompleted(
            remainderReminder.remainderScheduledTimes,
            task.remainderScheduledTimesCompleted as Date[] | undefined
        );

        await ModelTask.findOneAndUpdate(
            { _id: taskId },
            {
                dueDateReminderScheduledTimes: dueFiltered,
                remainderScheduledTimes: remFiltered,
            }
        );

        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
};

export const computeReminderScheduledTimesForDueDate = async ({
    taskId,
    cronTimeZone,
}: {
    taskId: mongoose.Types.ObjectId;
    cronTimeZone: string;
}) => {
    try {
        const task = (await ModelTask.findOne({
            _id: taskId,
        }).lean()) as tsTaskList | null;

        if (!task) {
            return false;
        }

        const dueReminder = computeRemainderScheduledTimesFromInput({
            cronExpressions: (task.dueDateReminderCronExpressions as string[]) || [],
            cronTimeZone: cronTimeZone,
            absoluteTimesIso: (task.dueDateReminderAbsoluteTimesIso as string[]) || [],
            presetLabels: (task.dueDateReminderPresetLabels as string[]) || [],
            dueDate: task.dueDate ? new Date(task.dueDate as string | Date) : null,
        });

        const dueFiltered = filterInstantsNotInCompleted(
            dueReminder.remainderScheduledTimes,
            task.dueDateReminderScheduledTimesCompleted as Date[] | undefined
        );

        await ModelTask.findOneAndUpdate(
            { _id: taskId },
            {
                dueDateReminderScheduledTimes: dueFiltered,
            }
        );

        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
};
