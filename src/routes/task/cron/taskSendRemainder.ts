import mongoose, { FilterQuery } from 'mongoose';
import { ModelTask } from '../../../schema/schemaTask/SchemaTask.schema';
import { funcSendMail } from '../../../utils/files/funcSendMail';
import { ModelUser } from '../../../schema/schemaUser/SchemaUser.schema';
import { ModelUserApiKey } from '../../../schema/schemaUser/SchemaUserApiKey.schema';
import { computeRemainderScheduledTimesFromInput } from '../../../utils/task/computeRemainderScheduledTimesInput';
import {
    computeReminderScheduledTimes,
    computeReminderScheduledTimesForDueDate,
} from '../../../utils/task/computeReminderScheduledTimesTask';
import { CronExpressionParser } from 'cron-parser';

const CRON_FIRE_WINDOW_MS = 5 * 60 * 1000;

function getCronPrevIfShouldFire(
    expr: string,
    now: Date
): { prev: Date } | null {
    try {
        const interval = CronExpressionParser.parse(expr, { currentDate: now, tz: 'UTC' });
        const prev = interval.prev().toDate();
        const delta = now.getTime() - prev.getTime();
        if (delta <= 0 || delta > CRON_FIRE_WINDOW_MS) {
            return null;
        }
        return { prev };
    } catch {
        return null;
    }
}

const buildEmailHtml = (
    resultTask: {
        title: string;
        description?: string;
        dueDate?: Date | null;
        _id: unknown;
    },
    clientUrl: string
) => {
    return `
            <p>Hello,</p>
            <p>This is a reminder for your task:</p>
            <ul>
                <li><strong>Title:</strong> ${resultTask.title}</li>
                <li><strong>Description:</strong> ${resultTask.description || 'No description'}</li>
                <li><strong>Due Date:</strong> ${resultTask.dueDate ? new Date(resultTask.dueDate).toUTCString() : 'No due date'}</li>
                <a href="${clientUrl}/user/task?edit-task-id=${resultTask._id}">View Task</a>
            </ul>
            <p>Please take the necessary action.</p>
        `;
};

const sendTaskReminderEmail = async ({
    resultTask,
    userInfo,
    apiKeys,
}: {
    resultTask: {
        title: string;
        description?: string;
        dueDate?: Date | null;
        _id: unknown;
    };
    userInfo: { username: string; email: string };
    apiKeys: { clientFrontendUrl: string };
}): Promise<boolean> => {
    const emailSubject = `Task Reminder: ${resultTask.title}`;
    const emailBody = buildEmailHtml(resultTask, apiKeys.clientFrontendUrl);

    const userEmail = userInfo.email;
    if (!userEmail || !userEmail.includes('@')) {
        console.warn(`No valid email found for user: ${userInfo.username}`);
        return false;
    }
    try {
        await funcSendMail({
            username: userInfo.username,
            smtpTo: userEmail,
            subject: emailSubject,
            text: '',
            html: emailBody,
        });
        console.log(`Reminder email sent to ${userEmail} for task ${resultTask._id}`);
        return true;
    } catch (mailErr) {
        console.error('Failed to send reminder email:', mailErr);
        return false;
    }
};

const sortDatesAsc = (dates: Date[]): Date[] =>
    [...dates].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

const processTaskAbsoluteTimes = async ({
    _id,
}: {
    _id: mongoose.Types.ObjectId;
}): Promise<boolean> => {
    try {
        const raw = await ModelTask.findOne({ _id }).lean();
        if (!raw) {
            throw new Error('Task not found');
        }
        const resultTask = raw as Record<string, unknown>;

        const cronTimeZone = resultTask.cronTimeZone;

        const userInfo = await ModelUser.findOne({
            username: resultTask.username as string,
            emailVerified: true,
            email: {
                $ne: '',
            },
        });
        if (!userInfo) {
            throw new Error('User not found');
        }
        let userTimeZone = 'UTC';
        if (userInfo) {
            userTimeZone = userInfo.timeZoneRegion;
        }

        computeRemainderScheduledTimesFromInput({
            cronExpressions: (resultTask.dueDateReminderCronExpressions as string[]) || [],
            cronTimeZone: userTimeZone,
            absoluteTimesIso: (resultTask.dueDateReminderAbsoluteTimesIso as string[]) || [],
            presetLabels: (resultTask.dueDateReminderPresetLabels as string[]) || [],
            dueDate: resultTask.dueDate ? new Date(resultTask.dueDate as string | Date) : null,
        });

        const dueTimes = (resultTask.dueDateReminderScheduledTimes as Date[] | undefined) || [];
        const remTimes = (resultTask.remainderScheduledTimes as Date[] | undefined) || [];
        if (dueTimes.length === 0 && remTimes.length === 0) {
            return false;
        }

        if (!userInfo) {
            throw new Error('User not found');
        }

        const apiKeys = await ModelUserApiKey.findOne({
            username: resultTask.username as string,
        });
        if (!apiKeys) {
            throw new Error('Api keys not found');
        }

        const currentTimeUtc = new Date();

        type TSource = 'due' | 'remainder';
        const candidates: { t: Date; source: TSource }[] = [];
        for (const t of dueTimes) {
            const d = new Date(t);
            if (!Number.isNaN(d.getTime()) && d <= currentTimeUtc) {
                candidates.push({ t: d, source: 'due' });
            }
        }
        for (const t of remTimes) {
            const d = new Date(t);
            if (!Number.isNaN(d.getTime()) && d <= currentTimeUtc) {
                candidates.push({ t: d, source: 'remainder' });
            }
        }
        if (candidates.length === 0) {
            return false;
        }
        candidates.sort((a, b) => {
            const dt = a.t.getTime() - b.t.getTime();
            if (dt !== 0) return dt;
            if (a.source === 'due' && b.source === 'remainder') return -1;
            if (a.source === 'remainder' && b.source === 'due') return 1;
            return 0;
        });
        const best = candidates[0];
        const firedAt = best.t;

        const sent = await sendTaskReminderEmail({
            resultTask: resultTask as Parameters<typeof sendTaskReminderEmail>[0]['resultTask'],
            userInfo: userInfo as { username: string; email: string },
            apiKeys: apiKeys as { clientFrontendUrl: string },
        });

        if (sent) {
            const firedMs = firedAt.getTime();
            if (best.source === 'due') {
                const nextDue = dueTimes.filter((time) => new Date(time).getTime() !== firedMs);
                const completedDue = sortDatesAsc([
                    ...((resultTask.dueDateReminderScheduledTimesCompleted as Date[]) || []),
                    firedAt,
                ]);
                await ModelTask.updateOne(
                    { _id },
                    {
                        $set: {
                            dueDateReminderScheduledTimes: nextDue,
                            dueDateReminderScheduledTimesCompleted: completedDue,
                        },
                    }
                );
            } else {
                const nextRem = remTimes.filter((time) => new Date(time).getTime() !== firedMs);
                const completedRem = sortDatesAsc([
                    ...((resultTask.remainderScheduledTimesCompleted as Date[]) || []),
                    firedAt,
                ]);
                await ModelTask.updateOne(
                    { _id },
                    {
                        $set: {
                            remainderScheduledTimes: nextRem,
                            remainderScheduledTimesCompleted: completedRem,
                        },
                    }
                );
            }

            await computeReminderScheduledTimes({
                taskId: _id,
                cronTimeZone: userTimeZone,
            });
            await computeReminderScheduledTimesForDueDate({
                taskId: _id,
                cronTimeZone: userTimeZone,
            });
        }

        return sent;
    } catch (error) {
        console.log('error in processTaskAbsoluteTimes: ', error);
        return false;
    }
};

const processTaskCronReminders = async ({
    _id,
}: {
    _id: mongoose.Types.ObjectId;
}): Promise<boolean> => {
    try {
        const raw = await ModelTask.findOne({ _id }).lean();
        if (!raw) {
            return false;
        }
        const resultTask = raw;

        const userInfo = await ModelUser.findOne({
            username: resultTask.username as string,
            emailVerified: true,
            email: { $ne: '' },
        });
        if (!userInfo) {
            return false;
        }
        let userTimeZone = 'UTC';
        if (userInfo) {
            userTimeZone = userInfo.timeZoneRegion;
        }

        computeRemainderScheduledTimesFromInput({
            cronExpressions: (resultTask.remainderCronExpressions as string[]) || [],
            cronTimeZone: userTimeZone,
            absoluteTimesIso: (resultTask.remainderAbsoluteTimesIso as string[]) || [],
            presetLabels: [],
            dueDate: null,
        });

        const remainderCron = resultTask.remainderCronExpressions as string[] | undefined;
        const dueCron = resultTask.dueDateReminderCronExpressions as string[] | undefined;
        const cronArr = [
            ...(Array.isArray(remainderCron) ? remainderCron : []),
            ...(Array.isArray(dueCron) ? dueCron : []),
        ];
        if (cronArr.length === 0) {
            return false;
        }

        if (!userInfo) {
            return false;
        }

        const apiKeys = await ModelUserApiKey.findOne({
            username: resultTask.username as string,
        });
        if (!apiKeys) {
            return false;
        }

        const now = new Date();
        let firedExpr: string | null = null;

        for (const expr of cronArr) {
            if (typeof expr !== 'string' || !expr.trim()) continue;
            const eTrim = expr.trim();
            const hit = getCronPrevIfShouldFire(eTrim, now);
            if (!hit) continue;
            firedExpr = eTrim;
            break;
        }

        if (!firedExpr) {
            return false;
        }

        const sent = await sendTaskReminderEmail({
            resultTask: resultTask as Parameters<typeof sendTaskReminderEmail>[0]['resultTask'],
            userInfo: userInfo as { username: string; email: string },
            apiKeys: apiKeys as { clientFrontendUrl: string },
        });

        if (sent) {
            await computeReminderScheduledTimes({
                taskId: _id,
                cronTimeZone: userTimeZone,
            });
            await computeReminderScheduledTimesForDueDate({
                taskId: _id,
                cronTimeZone: userTimeZone,
            });
        }

        return sent;
    } catch (error) {
        console.log('error in processTaskCronReminders: ', error);
        return false;
    }
};

export const cronTaskSendRemainder = async () => {
    const currentTimeUtc = new Date();

    try {
        console.log('running a task every 5 minutes');

        const resultsAbsolute = await ModelTask.find({
            isArchived: false,
            isCompleted: false,
            $or: [
                { remainderScheduledTimes: { $elemMatch: { $lte: currentTimeUtc } } },
                { dueDateReminderScheduledTimes: { $elemMatch: { $lte: currentTimeUtc } } },
            ],
        } as FilterQuery<Record<string, unknown>>);

        for (const result of resultsAbsolute) {
            await processTaskAbsoluteTimes({
                _id: result._id as mongoose.Types.ObjectId,
            });
        }

        const resultsCron = await ModelTask.find({
            isArchived: false,
            isCompleted: false,
            $or: [
                { 'remainderCronExpressions.0': { $exists: true } },
                { 'dueDateReminderCronExpressions.0': { $exists: true } },
            ],
        } as FilterQuery<Record<string, unknown>>);

        for (const result of resultsCron) {
            await processTaskCronReminders({
                _id: result._id as mongoose.Types.ObjectId,
            });
        }
    } catch (error) {
        console.log('error in cron: ', error);
    }
};
