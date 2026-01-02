import mongoose, { PipelineStage } from 'mongoose';
import { CronExpressionParser } from 'cron-parser';

import { ModelFaq } from '../../../schema/schemaFaq/SchemaFaq.schema';
import { ModelLlmPendingTaskCron } from '../../../schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema';
import { llmPendingTaskTypes } from '../../../utils/llmPendingTask/llmPendingTaskConstants';
import { getMongodbObjectOrNull } from '../../../utils/common/getMongodbObjectOrNull';

/**
 * Revalidate FAQ schedule execution time by ID
 */
export const revalidateFaqScheduleExecutionTimeById = async ({
    _id,
    auth_username,
}: {
    _id: string;
    auth_username: string;
}) => {
    const SECOND_TO_MILLISECOND = 1000;
    const SECOND_SIXTY = 60;

    try {
        const resultFaq = await ModelFaq.aggregate([
            {
                $match: {
                    _id: getMongodbObjectOrNull(_id),
                    username: auth_username,
                }
            },
            {
                $addFields: {
                    cronExpressionArrLen: {
                        $size: '$cronExpressionArr'
                    }
                }
            },
            {
                $match: {
                    cronExpressionArrLen: { $gt: 0 }
                }
            }
        ]);

        if (resultFaq.length === 0) {
            return;
        }

        let scheduleExecutionTimeArr: Date[] = [];
        const itemFaq = resultFaq[0];

        // Process cron expressions
        if (itemFaq.cronExpressionArr && itemFaq.cronExpressionArr.length > 0) {
            for (const cronExpression of itemFaq.cronExpressionArr) {
                try {
                    const interval = CronExpressionParser.parse(cronExpression, {
                        currentDate: new Date(),
                        tz: itemFaq.timezoneName || 'UTC'
                    });

                    // Get next 101 occurrences for this cron expression
                    for (let i = 0; i < 101; i++) {
                        const nextDate = interval.next().toDate();
                        scheduleExecutionTimeArr.push(nextDate);
                    }
                } catch (err: any) {
                    console.error(`Error parsing cron expression ${cronExpression}:`, err.message);
                }
            }
        }

        // Remove duplicates
        scheduleExecutionTimeArr = [...new Set(scheduleExecutionTimeArr.map(d => d.getTime()))].map(t => new Date(t));

        // Sort by date
        scheduleExecutionTimeArr.sort((a, b) => a.getTime() - b.getTime());

        // Take first 101 dates
        scheduleExecutionTimeArr = scheduleExecutionTimeArr.slice(0, 101);

        // Update scheduleExecutionTimeArr
        await ModelFaq.updateOne(
            { _id: itemFaq._id },
            { $set: { scheduleExecutionTimeArr: scheduleExecutionTimeArr } }
        );
    } catch (error) {
        console.error(error);
    }
};

/**
 * Execute FAQ schedule for a specific user
 */
export const executeFaqSchedule = async ({
    auth_username,
}: {
    auth_username: string;
}) => {
    try {
        const itemFaqs = await ModelFaq.aggregate([
            {
                $match: {
                    username: auth_username,
                    isActive: true,
                }
            },
            {
                $addFields: {
                    cronExpressionArrLen: {
                        $size: '$cronExpressionArr'
                    },
                    scheduleExecutionTimeArrLen: {
                        $size: '$scheduleExecutionTimeArr'
                    }
                }
            },
            {
                $match: {
                    cronExpressionArrLen: { $gt: 0 },
                    scheduleExecutionTimeArrLen: { $gt: 0 }
                }
            }
        ]);

        for (const itemFaq of itemFaqs) {
            const scheduleExecutionTimeArr = itemFaq.scheduleExecutionTimeArr;

            for (const scheduleExecutionTime of scheduleExecutionTimeArr) {
                let shouldExecute = true;

                // Check if time is less than current time
                const dateUtcExecute = new Date(scheduleExecutionTime).valueOf();
                const currentTimeValueOf = new Date().valueOf();

                if ((currentTimeValueOf - dateUtcExecute) / 1000 >= 1) {
                    // May execute now
                } else {
                    shouldExecute = false;
                    continue;
                }

                // Check in scheduleExecutedTimeArr
                if (Array.isArray(itemFaq.scheduleExecutedTimeArr)) {
                    let doesExist = false;

                    for (const scheduleExecutedTime of itemFaq.scheduleExecutedTimeArr) {
                        if (new Date(scheduleExecutedTime).valueOf() === new Date(scheduleExecutionTime).valueOf()) {
                            doesExist = true;
                            break;
                        }
                    }

                    if (doesExist) {
                        // Don't execute now as time is already executed
                        shouldExecute = false;
                        continue;
                    }
                }

                if (shouldExecute) {
                    // Can execute now

                    // Update scheduleExecutedTimeArr
                    await ModelFaq.updateOne(
                        { _id: itemFaq._id },
                        {
                            $push: { scheduleExecutedTimeArr: scheduleExecutionTime },
                            $inc: { executedTimes: 1 }
                        }
                    );

                    // Revalidate
                    const recordId = (itemFaq._id as mongoose.Types.ObjectId).toString();
                    await revalidateFaqScheduleExecutionTimeById({
                        _id: recordId,
                        auth_username: auth_username,
                    });

                    // Insert record in llmPendingTaskCron for Feature AI Actions generation
                    if (itemFaq.metadataSourceId && itemFaq.metadataSourceType) {
                        await ModelLlmPendingTaskCron.create({
                            username: auth_username,
                            taskType: llmPendingTaskTypes.page.featureAiActions.all,
                            targetRecordId: itemFaq.metadataSourceId,
                            taskOutputJson: {
                                sourceType: itemFaq.metadataSourceType,
                            },
                        });
                    }

                    break;
                }
            }
        }
    } catch (error) {
        console.error(error);
    }
};

/**
 * Execute FAQ schedule for all users
 */
export const executeFaqScheduleForAllUsers = async () => {
    try {
        // Get all users with FAQ schedules
        const itemFaqs = await ModelFaq.aggregate([
            {
                $group: {
                    _id: '$username',
                    username: { $first: '$username' },
                }
            },
            {
                $project: {
                    _id: 0,
                    username: 1,
                }
            }
        ]) as {
            username: string;
        }[];

        for (const itemFaq of itemFaqs) {
            await executeFaqSchedule({
                auth_username: itemFaq.username,
            });
        }
    } catch (error) {
        console.error(error);
    }
};

