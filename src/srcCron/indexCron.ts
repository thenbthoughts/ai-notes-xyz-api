import cron from 'node-cron';

const initCron = () => {
    cron.schedule(
        '*/30 * * * * *',
        () => {
            try {
                console.log('running a task every 30 seconds');
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