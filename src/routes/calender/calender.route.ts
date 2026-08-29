import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelRecordEmptyTable } from '../../schema/schemaOther/NoRecordTable';
import { ModelTask } from '../../schema/schemaTask/SchemaTask.schema';
import { ModelLifeEvents } from '../../schema/schemaLifeEvents/SchemaLifeEvents.schema';
import { ModelInfoVaultSignificantDate } from '../../schema/schemaInfoVault/SchemaInfoVaultSignificantDate.schema';

// Router
const router = Router();

const getCalenderFromTasks = ({
    userId,
    startDate,
    endDate,
    searchText,
}: {
    userId: string;
    startDate: Date;
    endDate: Date;
    searchText?: string;
}) => {
    type PipelineStageCustom = PipelineStage.Match | PipelineStage.AddFields | PipelineStage.Lookup | PipelineStage.Project;

    let tempStage = {} as PipelineStageCustom;
    const stateDocument = [] as PipelineStageCustom[];

    // stateDocument -> match
    tempStage = {
        $match: {
            userId: userId,
            dueDate: {
                $lte: endDate,
                $gte: startDate,
            },
        }
    };
    if (searchText && searchText.trim()) {
        const rx = { $regex: searchText.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
        (tempStage.$match as Record<string, unknown>)['title'] = rx;
    }
    stateDocument.push(tempStage);

    // stateDocument -> addFields -> fromCollection
    tempStage = {
        $addFields: {
            fromCollection: 'tasks',
        }
    };
    stateDocument.push(tempStage);

    // stateDocument -> project
    tempStage = {
        $project: {
            _id: 1,
            fromCollection: 1,
            taskInfo: "$$ROOT"
        }
    };
    stateDocument.push(tempStage);

    return stateDocument;
}

const getCalenderFromTaskReminderByLookup = ({
    userId,
    startDate,
    endDate,
    reminderField,
    fromCollection,
    searchText,
}: {
    userId: string;
    startDate: Date;
    endDate: Date;
    reminderField: 'remainderScheduledTimes' | 'dueDateReminderScheduledTimes';
    fromCollection: 'taskRemainders' | 'taskDueDateRemainders';
    searchText?: string;
}) => {
    type PipelineStageCustom =
        | PipelineStage.Match
        | PipelineStage.AddFields
        | PipelineStage.Lookup
        | PipelineStage.Project
        | PipelineStage.Unwind;

    let tempStage = {} as PipelineStageCustom;
    const stateDocument = [] as PipelineStageCustom[];

    // stateDocument -> match
    // @ts-ignore
    tempStage = {
        $match: {
            userId: userId,
        }
    };
    if (searchText && searchText.trim()) {
        (tempStage as unknown as { $match: Record<string, unknown> }).$match['title'] = { $regex: searchText.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }
    stateDocument.push(tempStage);

    // stateDocument -> lookup (self lookup to isolate reminder field and title)
    tempStage = {
        $lookup: {
            from: 'tasks',
            let: {
                taskId: '$_id',
            },
            pipeline: [
                {
                    $match: {
                        $expr: {
                            $eq: ['$_id', '$$taskId']
                        }
                    }
                },
                {
                    $project: {
                        _id: 1,
                        title: 1,
                        dueDate: 1,
                        reminderTimes: `$${reminderField}`,
                    }
                },
            ],
            as: 'taskReminderLookup',
        }
    };
    stateDocument.push(tempStage);

    // stateDocument -> unwind taskReminderLookup
    tempStage = {
        $unwind: {
            path: '$taskReminderLookup',
        }
    };
    stateDocument.push(tempStage);

    // stateDocument -> unwind reminderTimes (each reminder as separate record)
    tempStage = {
        $unwind: {
            path: '$taskReminderLookup.reminderTimes',
        }
    };
    stateDocument.push(tempStage);

    // stateDocument -> match reminder date range
    tempStage = {
        $match: {
            'taskReminderLookup.reminderTimes': {
                $lte: endDate,
                $gte: startDate,
            },
        }
    };
    stateDocument.push(tempStage);

    // stateDocument -> addFields -> fromCollection
    tempStage = {
        $addFields: {
            fromCollection: fromCollection,
        }
    };
    stateDocument.push(tempStage);

    // stateDocument -> project
    tempStage = {
        $project: {
            _id: 1,
            fromCollection: 1,
            taskReminderInfo: {
                _id: '$taskReminderLookup._id',
                title: '$taskReminderLookup.title',
                dueDate: '$taskReminderLookup.dueDate',
                reminderTime: '$taskReminderLookup.reminderTimes',
            },
        }
    };
    stateDocument.push(tempStage);

    return stateDocument;
}

const getCalenderFromLifeEvents = ({
    userId,
    startDate,
    endDate,

    filterEventTypeDiary,
    searchText,
}: {
    userId: string;
    startDate: Date;
    endDate: Date;

    filterEventTypeDiary: boolean;
    searchText?: string;
}) => {
    type PipelineStageCustom = PipelineStage.Match | PipelineStage.AddFields | PipelineStage.Lookup | PipelineStage.Project;

    let tempStage = {} as PipelineStageCustom;
    const stateDocument = [] as PipelineStageCustom[];

    // stateDocument -> match
    tempStage = {
        $match: {
            userId: userId,
            eventDateUtc: {
                $lte: endDate,
                $gte: startDate,
            },
        }
    };
    if (filterEventTypeDiary === false) {
        tempStage.$match.title = {
            $not: {
                $regex: '(Daily|Weekly|Monthly) Summary by AI',
                $options: 'i',
            }
        };
    }
    stateDocument.push(tempStage);
    if (searchText && searchText.trim()) {
        const rx = { $regex: searchText.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
        if (filterEventTypeDiary === false) {
            stateDocument.push({ $match: { title: rx } } as PipelineStageCustom);
        }
    }

    // stateDocument -> addFields -> fromCollection
    tempStage = {
        $addFields: {
            fromCollection: 'lifeEvents',
        }
    };
    stateDocument.push(tempStage);

    // stateDocument -> project
    tempStage = {
        $project: {
            _id: 1,
            fromCollection: 1,
            lifeEventInfo: "$$ROOT"
        }
    };
    stateDocument.push(tempStage);

    return stateDocument;
}

const getCalenderFromInfoVaultSignificantDate = ({
    userId,
    startDate,
    endDate,
    searchText,
}: {
    userId: string;
    startDate: Date;
    endDate: Date;
    searchText?: string;
}) => {
    type PipelineStageCustom = PipelineStage.Match | PipelineStage.AddFields | PipelineStage.Lookup | PipelineStage.Project;

    let tempStage = {} as PipelineStageCustom;
    const stateDocument = [] as PipelineStageCustom[];

    // stateDocument -> match
    // @ts-ignore
    tempStage = {
        $match: {
            userId: userId,
            date: {
                $lte: endDate,
                $gte: startDate,
            },
        }
    };
    if (searchText && searchText.trim()) {
        (tempStage as unknown as { $match: Record<string, unknown> }).$match['label'] = { $regex: searchText.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }
    stateDocument.push(tempStage);

    // stateDocument -> addFields -> fromCollection
    tempStage = {
        $addFields: {
            fromCollection: 'infoVaultSignificantDate',
        }
    };
    stateDocument.push(tempStage);

    // stateDocument -> project
    tempStage = {
        $project: {
            _id: 1,
            fromCollection: 1,
            infoVaultSignificantDate: "$$ROOT"
        }
    };
    stateDocument.push(tempStage);

    return stateDocument;
}

const getCalenderFromInfoVaultSignificantDateRepeat = ({
    userId,
    startDate,
    endDate,
    searchText,
}: {
    userId: string;
    startDate: Date;
    endDate: Date;
    searchText?: string;
}) => {
    type PipelineStageCustom = PipelineStage.Match | PipelineStage.AddFields | PipelineStage.Lookup | PipelineStage.Project;

    let tempStage = {} as PipelineStageCustom;
    const stateDocument = [] as PipelineStageCustom[];

    // stateDocument -> addFields -> normalizedDate (set year to current year for comparison)
    const currentYear = new Date().getFullYear();
    tempStage = {
        $addFields: {
            normalizedDate: {
                $dateFromParts: {
                    year: currentYear,
                    month: { $month: "$date" },
                    day: { $dayOfMonth: "$date" },
                    hour: { $hour: "$date" },
                    minute: { $minute: "$date" },
                    second: { $second: "$date" },
                    millisecond: { $millisecond: "$date" },
                }
            }
        }
    };
    stateDocument.push(tempStage);

    // stateDocument -> match
    tempStage = {
        $match: {
            userId: userId,
            normalizedDate: {
                $lte: endDate,
                $gte: startDate,
            },
        }
    };
    stateDocument.push(tempStage);
    if (searchText && searchText.trim()) {
        stateDocument.push({ $match: { label: { $regex: searchText.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } } as PipelineStageCustom);
    }

    // stateDocument -> addFields -> fromCollection
    tempStage = {
        $addFields: {
            fromCollection: 'infoVaultSignificantDateRepeat',
        }
    };
    stateDocument.push(tempStage);

    // stateDocument -> project
    tempStage = {
        $project: {
            _id: 1,
            fromCollection: 1,
            infoVaultSignificantDateRepeat: "$$ROOT",
            normalizedDate: 1,
        }
    };
    stateDocument.push(tempStage);

    return stateDocument;
}

const getCalenderFromTaskSchedule = ({
    userId,
    startDate,
    endDate,
    searchText,
}: {
    userId: string;
    startDate: Date;
    endDate: Date;
    searchText?: string;
}) => {
    type PipelineStageCustom = PipelineStage.Match | PipelineStage.AddFields | PipelineStage.Lookup | PipelineStage.Project | PipelineStage.Unwind;

    let tempStage = {} as PipelineStageCustom;
    const stateDocument = [] as PipelineStageCustom[];

    // stateDocument -> match
    // @ts-ignore
    tempStage = {
        $match: {
            userId: userId,
            isActive: true,
        }
    };
    if (searchText && searchText.trim()) {
        (tempStage as unknown as { $match: Record<string, unknown> }).$match['title'] = { $regex: searchText.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }
    stateDocument.push(tempStage);

    // stageDocument -> addFields -> scheduleExecutionTimeArr (limit to first 7 elements)
    tempStage = {
        $addFields: {
            scheduleExecutionTimeArr: {
                $slice: ['$scheduleExecutionTimeArr', 7]
            }
        }
    };
    stateDocument.push(tempStage);

    // stageDocument -> unwind
    tempStage = {
        $unwind: {
            path: '$scheduleExecutionTimeArr',
        }
    };
    stateDocument.push(tempStage);

    // stageDocument -> addFields -> scheduleExecutionTime
    tempStage = {
        $addFields: {
            scheduleExecutionTime: '$scheduleExecutionTimeArr',
        }
    };
    stateDocument.push(tempStage);

    // stageDocument -> match
    tempStage = {
        $match: {
            scheduleExecutionTime: {
                $lte: endDate,
                $gte: startDate,
            },
        }
    };
    stateDocument.push(tempStage);

    // stateDocument -> addFields -> fromCollection
    tempStage = {
        $addFields: {
            fromCollection: 'taskSchedules',
        }
    };
    stateDocument.push(tempStage);

    // stateDocument -> project
    tempStage = {
        $project: {
            _id: 1,
            fromCollection: 1,
            taskScheduleInfo: "$$ROOT"
        }
    };
    stateDocument.push(tempStage);

    return stateDocument;
}

// Get CalenderAPI
router.post(
    '/calenderGet',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            // args
            let page = 1;
            let perPage = 100;
            let startDate = new Date();
            let endDate = new Date();

            let filterEventTypeTasks = true;
            let filterEventTypeLifeEvents = true;
            let filterEventTypeInfoVault = true;
            let filterEventTypeDiary = true;
            let filterEventTypeTaskSchedule = true;
            let searchText = '';
            if (typeof req.body?.searchText === 'string') { searchText = req.body.searchText.trim().slice(0, 100); }

            // set arg -> page
            if (typeof req.body?.page === 'number') {
                if (req.body.page >= 1) {
                    page = req.body.page;
                }
            }
            // set arg -> perPage
            if (typeof req.body?.perPage === 'number') {
                if (req.body.perPage >= 1) {
                    perPage = req.body.perPage;
                }
            }

            // set arg -> filterEventTypeTasks
            if (typeof req.body?.filterEventTypeTasks === 'boolean') {
                filterEventTypeTasks = req.body.filterEventTypeTasks;
            }
            // set arg -> filterEventTypeLifeEvents
            if (typeof req.body?.filterEventTypeLifeEvents === 'boolean') {
                filterEventTypeLifeEvents = req.body.filterEventTypeLifeEvents;
            }
            // set arg -> filterEventTypeInfoVault
            if (typeof req.body?.filterEventTypeInfoVault === 'boolean') {
                filterEventTypeInfoVault = req.body.filterEventTypeInfoVault;
            }
            // set arg -> filterEventTypeDiary
            if (typeof req.body?.filterEventTypeDiary === 'boolean') {
                filterEventTypeDiary = req.body.filterEventTypeDiary;
            }
            // set arg -> filterEventTypeTaskSchedule
            if (typeof req.body?.filterEventTypeTaskSchedule === 'boolean') {
                filterEventTypeTaskSchedule = req.body.filterEventTypeTaskSchedule;
            }

            let tempStage = {} as PipelineStage;
            const stateDocument = [] as PipelineStage[];

            // set arg -> startDate
            if (typeof req.body?.startDate === 'string') {
                startDate = new Date(req.body.startDate);
            }
            // set arg -> endDate
            if (typeof req.body?.endDate === 'string') {
                endDate = new Date(req.body.endDate);
            }

            // stateDocument -> unionWith
            if (filterEventTypeTasks) {
                tempStage = {
                    $unionWith: {
                        coll: 'tasks',
                        pipeline: getCalenderFromTasks({
                            userId: res.locals.auth_userId,
                            startDate,
                            endDate,
                            searchText,
                        }),
                    }
                };
                stateDocument.push(tempStage);

                // task remainder reminders (lookup + unwind one record per reminder)
                tempStage = {
                    $unionWith: {
                        coll: 'tasks',
                        pipeline: getCalenderFromTaskReminderByLookup({
                            userId: res.locals.auth_userId,
                            startDate,
                            endDate,
                            reminderField: 'remainderScheduledTimes',
                            fromCollection: 'taskRemainders',
                            searchText,
                        }),
                    }
                };
                stateDocument.push(tempStage);

                // due-date reminder reminders (lookup + unwind one record per reminder)
                tempStage = {
                    $unionWith: {
                        coll: 'tasks',
                        pipeline: getCalenderFromTaskReminderByLookup({
                            userId: res.locals.auth_userId,
                            startDate,
                            endDate,
                            reminderField: 'dueDateReminderScheduledTimes',
                            fromCollection: 'taskDueDateRemainders',
                            searchText,
                        }),
                    }
                };
                stateDocument.push(tempStage);
            }

            if (filterEventTypeLifeEvents) {
                // stateDocument -> unionWith
                tempStage = {
                    $unionWith: {
                        coll: 'lifeEvents',
                        pipeline: getCalenderFromLifeEvents({
                            userId: res.locals.auth_userId,
                            startDate,
                            endDate,

                            // 
                            filterEventTypeDiary,
                            searchText,
                        }),
                    }
                };
                stateDocument.push(tempStage);
            }

            // stateDocument -> unionWith
            if (filterEventTypeInfoVault) {
                tempStage = {
                    $unionWith: {
                        coll: 'infoVaultSignificantDate',
                        pipeline: getCalenderFromInfoVaultSignificantDate({
                            userId: res.locals.auth_userId,
                            startDate,
                            endDate,
                            searchText,
                        }),
                    }
                };
                stateDocument.push(tempStage);
            }

            // stateDocument -> unionWith
            if (filterEventTypeInfoVault) {
                tempStage = {
                    $unionWith: {
                        coll: 'infoVaultSignificantDate',
                        pipeline: getCalenderFromInfoVaultSignificantDateRepeat({
                            userId: res.locals.auth_userId,
                            startDate,
                            endDate,
                            searchText,
                        }),
                    }
                };
                stateDocument.push(tempStage);
            }

            // stateDocument -> unionWith
            if (filterEventTypeTaskSchedule) {
                tempStage = {
                    $unionWith: {
                        coll: 'taskSchedules',
                        pipeline: getCalenderFromTaskSchedule({
                            userId: res.locals.auth_userId,
                            startDate,
                            endDate,
                            searchText,
                        }),
                    }
                };
                stateDocument.push(tempStage);
            }

            // stateDocument -> skip
            tempStage = {
                $skip: (page - 1) * perPage,
            };
            stateDocument.push(tempStage);

            // stateDocument -> limit
            tempStage = {
                $limit: perPage,
            };
            stateDocument.push(tempStage);

            // pipeline
            const resultRecordEmptyTable = await ModelRecordEmptyTable.aggregate(stateDocument);

            return res.json({
                message: 'Calender retrieved successfully',
                count: resultRecordEmptyTable.length,
                docs: resultRecordEmptyTable,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

router.post('/calenderEdit', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const { recordId, fromCollection, start, end } = req.body as { recordId?: string; fromCollection?: string; start?: string; end?: string };
        if (!recordId || typeof recordId !== 'string' || recordId.length !== 24) {
            return res.status(400).json({ message: 'Invalid recordId' });
        }
        if (!fromCollection || typeof fromCollection !== 'string') {
            return res.status(400).json({ message: 'fromCollection required' });
        }
        const newStart = start ? new Date(start) : null;
        if (!newStart || Number.isNaN(newStart.getTime())) {
            return res.status(400).json({ message: 'Invalid start date' });
        }
        const newEnd = end ? new Date(end) : null;
        if (end && newEnd && Number.isNaN(newEnd.getTime())) {
            return res.status(400).json({ message: 'Invalid end date' });
        }
        const oid = mongoose.Types.ObjectId.createFromHexString(recordId);
        const userId = res.locals.auth_userId;
        if (fromCollection === 'tasks') {
            const updated = await ModelTask.findOneAndUpdate({ _id: oid, userId }, { dueDate: newStart }, { new: true });
            if (!updated) { return res.status(404).json({ message: 'Task not found' }); }
            return res.json({ message: 'Updated', doc: updated });
        }
        if (fromCollection === 'lifeEvents') {
            const updated = await ModelLifeEvents.findOneAndUpdate({ _id: oid, userId }, { eventDateUtc: newStart, eventDateYearStr: String(newStart.getFullYear()), eventDateYearMonthStr: `${newStart.getFullYear()}-${String(newStart.getMonth() + 1).padStart(2, '0')}` }, { new: true });
            if (!updated) { return res.status(404).json({ message: 'LifeEvent not found' }); }
            return res.json({ message: 'Updated', doc: updated });
        }
        if (fromCollection === 'infoVaultSignificantDate' || fromCollection === 'infoVaultSignificantDateRepeat') {
            const updated = await ModelInfoVaultSignificantDate.findOneAndUpdate({ _id: oid, userId }, { date: newStart }, { new: true });
            if (!updated) { return res.status(404).json({ message: 'Significant date not found' }); }
            return res.json({ message: 'Updated', doc: updated });
        }
        return res.status(400).json({ message: 'Collection not editable via calendar drag' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;