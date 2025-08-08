import cron from 'node-cron';

import { executeTaskScheduleForAllUsers } from '../routes/taskSchedule/taskSchedule.route';
import { ModelLlmPendingTaskCron } from '../schema/SchemaLlmPendingTaskCron.schema';
import llmPendingTaskProcessFunc from '../utils/llmPendingTask/llmPendingTaskProcessFunc';

const initCron = () => {
    cron.schedule(
        '* * * * *',
        async () => {
            try {
                console.log('running a task every minute');
                await executeTaskScheduleForAllUsers();
            } catch (error) {
                console.log('error in cron: ', error);
            }
        },
        {
            timezone: 'UTC',
            noOverlap: true,
        }
    );

    cron.schedule(
        '*/10 * * * * *',
        async () => {
            try {
                console.log('running a task every 10 seconds');
                const results = await ModelLlmPendingTaskCron.aggregate([
                    {
                        $match: {
                            taskStatus: 'pending',
                        }
                    },
                    {
                        $sort: {
                            _id: -1
                        }
                    },
                    {
                        $sample: {
                            size: 1
                        }
                    },
                ]);

                if (results.length === 1) {
                    const result = await llmPendingTaskProcessFunc({
                        _id: results[0]._id
                    });
                    console.log(result);
                }
            } catch (error) {
                console.log('error in cron: ', error);
            }
        },
        {
            noOverlap: true,
        }
    );
};

export default initCron;