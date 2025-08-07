import cron from 'node-cron';
import { executeTaskScheduleForAllUsers } from '../routes/taskSchedule/taskSchedule.route';

const initCron = () => {
    cron.schedule(
        '*/30 * * * * *',
        async () => {
            try {
                console.log('running a task every 30 seconds');
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
};

export default initCron;