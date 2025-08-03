import cron from 'node-cron';

const initCron = () => {
    cron.schedule(
        '* * * * *',
        () => {
            console.log('running a task every minute');
        },
        {   
            timezone: 'UTC',
            noOverlap: true,
        }
    );
};

export default initCron;