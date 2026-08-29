import { CronExpressionParser } from 'cron-parser';
import { REMINDER_LABEL_TO_MS } from '../../constants/reminderLabelToMsArr';

const TASK_REMINDER_SCHEDULED_CAP = 101;
const DEFAULT_MAX_CRON_OCCURRENCES_PER_EXPRESSION = 101;

/** 1) Cron expressions → upcoming execution instants. */
// TODO
export function remainderScheduledTimesFromCronExpressions(
    cronExpressions: string[],
    options?: { tz?: string; maxOccurrencesPerExpression?: number; currentDate?: Date }
): Date[] {
    const cronExprs: string[] = [];
    if (Array.isArray(cronExpressions)) {
        for (const x of cronExpressions) {
            if (typeof x === 'string' && x.trim() !== '') {
                cronExprs.push(x.trim());
            }
        }
    }
    const seenCron = new Set<string>();
    const uniqueCron = cronExprs.filter((c) => (seenCron.has(c) ? false : (seenCron.add(c), true)));

    const tz = options?.tz ?? 'UTC';
    const maxEach =
        options?.maxOccurrencesPerExpression ?? DEFAULT_MAX_CRON_OCCURRENCES_PER_EXPRESSION;
    const currentDate = options?.currentDate ?? new Date();
    const out: Date[] = [];

    for (const cronExpression of uniqueCron) {
        if (typeof cronExpression !== 'string' || !cronExpression.trim()) {
            continue;
        }
        try {
            const interval = CronExpressionParser.parse(cronExpression.trim(), {
                currentDate,
                tz,
            });
            for (let i = 0; i < maxEach; i++) {
                out.push(interval.next().toDate());
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`Error parsing cron expression ${cronExpression}:`, msg);
        }
    }

    return out;
}

/** 2) Absolute datetime ISO strings → valid `Date`s (deduped, sorted ISOs first). */
export function remainderScheduledTimesFromAbsoluteTimesIso(absoluteTimesIso: string[]): Date[] {
    const absIso: string[] = [];
    if (Array.isArray(absoluteTimesIso)) {
        for (const x of absoluteTimesIso) {
            if (typeof x === 'string' && x.trim() !== '') {
                const d = new Date(x);
                if (!Number.isNaN(d.getTime())) {
                    absIso.push(d.toISOString());
                }
            }
        }
    }
    const sortedUnique = [...new Set(absIso)].sort();
    const dates: Date[] = [];
    for (const raw of sortedUnique) {
        const d = new Date(raw);
        if (!Number.isNaN(d.getTime())) {
            dates.push(d);
        }
    }
    return dates;
}

/** 3) Preset labels relative to a due date → concrete instants (two parameters). */
export function remainderScheduledTimesFromPresetLabels(
    dueDate: Date,
    presetLabels: string[]
): Date[] {
    if (!dueDate || Number.isNaN(dueDate.getTime())) {
        return [];
    }
    const dueMs = new Date(dueDate).getTime();
    if (Number.isNaN(dueMs)) {
        return [];
    }

    const labels: string[] = [];
    if (Array.isArray(presetLabels)) {
        for (const x of presetLabels) {
            if (typeof x === 'string' && x.trim() !== '') {
                labels.push(x.trim().toLowerCase());
            }
        }
    }
    if (labels.length === 0) {
        return [];
    }

    const seen = new Set<number>();
    const times: Date[] = [];
    for (const raw of labels) {
        const normalized = typeof raw === 'string' ? raw.toLowerCase().trim() : '';
        const found = REMINDER_LABEL_TO_MS.find((item) => item.labelName === normalized);
        if (found) {
            const t = dueMs - found.subTime;
            if (!seen.has(t)) {
                seen.add(t);
                times.push(new Date(t));
            }
        }
    }
    return times.sort((a, b) => a.getTime() - b.getTime());
}

/** 4) Accepts cron array, datetime ISO array, preset labels (and dueDate) and returns remainderScheduledTimes. */
export function computeRemainderScheduledTimesFromInput(input: {
    cronExpressions: string[];
    cronTimeZone: string;
    absoluteTimesIso: string[];
    presetLabels: string[];
    dueDate: Date | null;
}): {
    remainderScheduledTimes: Date[];
} {
    const cronPart = remainderScheduledTimesFromCronExpressions(input.cronExpressions, {
        tz: input.cronTimeZone,
    });
    const absolutePart = remainderScheduledTimesFromAbsoluteTimesIso(input.absoluteTimesIso);
    const presetPart =
        input.dueDate && !Number.isNaN(input.dueDate.getTime())
            ? remainderScheduledTimesFromPresetLabels(input.dueDate, input.presetLabels)
            : [];

    const combined = [...presetPart, ...absolutePart, ...cronPart];
    const seen = new Set<number>();
    const merged: Date[] = [];
    for (const d of combined) {
        const t = new Date(d).getTime();
        if (Number.isNaN(t)) continue;
        if (!seen.has(t)) {
            seen.add(t);
            merged.push(new Date(t));
        }
    }
    merged.sort((a, b) => a.getTime() - b.getTime());

    const capped =
        merged.length <= TASK_REMINDER_SCHEDULED_CAP
            ? merged
            : merged.slice(0, TASK_REMINDER_SCHEDULED_CAP);

    return { remainderScheduledTimes: capped };
}