import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelRecordEmptyTable } from '../../schema/schemaOther/NoRecordTable';

// Router
const router = Router();

const getCalenderFromTasks = ({
    username,
    startDate,
    endDate,
}: {
    username: string;
    startDate: Date;
    endDate: Date;
}) => {
    type PipelineStageCustom = PipelineStage.Match | PipelineStage.AddFields | PipelineStage.Lookup | PipelineStage.Project;

    let tempStage = {} as PipelineStageCustom;
    const stateDocument = [] as PipelineStageCustom[];

    // stateDocument -> match
    tempStage = {
        $match: {
            username: username,
            dueDate: {
                $lte: endDate,
                $gte: startDate,
            },
        }
    };
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

const getCalenderFromLifeEvents = ({
    username,
    startDate,
    endDate,

    filterEventTypeDiary,
}: {
    username: string;
    startDate: Date;
    endDate: Date;

    filterEventTypeDiary: boolean;
}) => {
    type PipelineStageCustom = PipelineStage.Match | PipelineStage.AddFields | PipelineStage.Lookup | PipelineStage.Project;

    let tempStage = {} as PipelineStageCustom;
    const stateDocument = [] as PipelineStageCustom[];

    // stateDocument -> match
    tempStage = {
        $match: {
            username: username,
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
    username,
    startDate,
    endDate,
}: {
    username: string;
    startDate: Date;
    endDate: Date;
}) => {
    type PipelineStageCustom = PipelineStage.Match | PipelineStage.AddFields | PipelineStage.Lookup | PipelineStage.Project;

    let tempStage = {} as PipelineStageCustom;
    const stateDocument = [] as PipelineStageCustom[];

    // stateDocument -> match
    tempStage = {
        $match: {
            username: username,
            date: {
                $lte: endDate,
                $gte: startDate,
            },
        }
    };
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
    username,
    startDate,
    endDate,
}: {
    username: string;
    startDate: Date;
    endDate: Date;
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
            username: username,
            normalizedDate: {
                $lte: endDate,
                $gte: startDate,
            },
        }
    };
    stateDocument.push(tempStage);

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
    username,
    startDate,
    endDate,
}: {
    username: string;
    startDate: Date;
    endDate: Date;
}) => {
    type PipelineStageCustom = PipelineStage.Match | PipelineStage.AddFields | PipelineStage.Lookup | PipelineStage.Project | PipelineStage.Unwind;

    let tempStage = {} as PipelineStageCustom;
    const stateDocument = [] as PipelineStageCustom[];

    // stateDocument -> match
    tempStage = {
        $match: {
            username: username,
            isActive: true,
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
                            username: res.locals.auth_username,
                            startDate,
                            endDate,
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
                            username: res.locals.auth_username,
                            startDate,
                            endDate,

                            // 
                            filterEventTypeDiary,
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
                            username: res.locals.auth_username,
                            startDate,
                            endDate,
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
                            username: res.locals.auth_username,
                            startDate,
                            endDate,
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
                            username: res.locals.auth_username,
                            startDate,
                            endDate,
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

export default router;