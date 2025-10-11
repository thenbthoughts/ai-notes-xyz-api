import { ModelLifeEvents } from '../../../schema/schemaLifeEvents/SchemaLifeEvents.schema';
import { DateTime } from 'luxon';
import { ModelUser } from '../../../schema/schemaUser/SchemaUser.schema';
import IUser from '../../../types/typesSchema/typesUser/SchemaUser.types';

const getTodaySummary = async (username: string): Promise<object | null> => {
    try {
        let todayDateUtc = new Date();
        let summaryDateOnly = new Date(todayDateUtc).toISOString().split('T')[0];
        let dailyNotesTitle = `Daily Summary by AI - ${summaryDateOnly}`;

        const docs = await ModelLifeEvents.aggregate([
            {
                $match: {
                    username: username,
                    title: dailyNotesTitle,
                },
            },
        ]);

        return docs.length > 0 ? docs[0] : null;
    } catch (error) {
        console.error(error);
        return null;
    }
};

const getYesterdaySummary = async (username: string): Promise<object | null> => {
    try {
        let yesterdayDateUtc = new Date(new Date().valueOf() - 24 * 60 * 60 * 1000);
        let summaryDateOnly = new Date(yesterdayDateUtc).toISOString().split('T')[0];
        let dailyNotesTitle = `Daily Summary by AI - ${summaryDateOnly}`;

        const docs = await ModelLifeEvents.aggregate([
            {
                $match: {
                    username: username,
                    title: dailyNotesTitle,
                },
            },
        ]);

        return docs.length > 0 ? docs[0] : null;
    } catch (error) {
        console.error(error);
        return null;
    }
};

const getCurrentWeekSummary = async (username: string): Promise<object | null> => {
    try {
        const userRecords = await ModelUser.find({
            username: username,
        }) as IUser[];
        if (!userRecords || userRecords.length !== 1) {
            return null;
        }
        const userFirst = userRecords[0];

        const summaryDateUtc = new Date();
        let weekNumber = DateTime.fromJSDate(summaryDateUtc).plus({ minutes: userFirst.timeZoneUtcOffset }).weekNumber;
        let weekStartDate = DateTime.fromJSDate(summaryDateUtc).minus({ minutes: userFirst.timeZoneUtcOffset }).startOf('week').toISODate();
        let weekEndDate = DateTime.fromJSDate(summaryDateUtc).minus({ minutes: userFirst.timeZoneUtcOffset }).endOf('week').toISODate();
        let weeklyNotesTitle = `Weekly Summary by AI - ${weekNumber} - From ${weekStartDate} to ${weekEndDate}`;

        console.log('weeklyNotesTitle: current week: ', weeklyNotesTitle);

        const docs = await ModelLifeEvents.aggregate([
            {
                $match: {
                    username: username,
                    title: weeklyNotesTitle,
                },
            },
        ]);

        return docs.length > 0 ? docs[0] : null;
    } catch (error) {
        console.error(error);
        return null;
    }
};

const getLastWeekSummary = async (username: string): Promise<object | null> => {
    try {
        const userRecords = await ModelUser.find({
            username: username,
        }) as IUser[];
        if (!userRecords || userRecords.length !== 1) {
            return null;
        }
        const userFirst = userRecords[0];

        const summaryDateUtc = new Date(
            new Date().valueOf() - 7 * 24 * 60 * 60 * 1000
        );
        let weekNumber = DateTime.fromJSDate(summaryDateUtc).plus({ minutes: userFirst.timeZoneUtcOffset }).weekNumber;
        let weekStartDate = DateTime.fromJSDate(summaryDateUtc).minus({ minutes: userFirst.timeZoneUtcOffset }).startOf('week').toISODate();
        let weekEndDate = DateTime.fromJSDate(summaryDateUtc).minus({ minutes: userFirst.timeZoneUtcOffset }).endOf('week').toISODate();
        let weeklyNotesTitle = `Weekly Summary by AI - ${weekNumber} - From ${weekStartDate} to ${weekEndDate}`;

        console.log('weeklyNotesTitle: last week: ', weeklyNotesTitle);

        const docs = await ModelLifeEvents.aggregate([
            {
                $match: {
                    username: username,
                    title: weeklyNotesTitle,
                },
            },
        ]);

        return docs.length > 0 ? docs[0] : null;
    } catch (error) {
        console.error(error);
        return null;
    }
};

const getCurrentMonthSummary = async (username: string): Promise<object | null> => {
    try {
        const summaryDateUtc = new Date();
        let monthYearStr = summaryDateUtc.getFullYear().toString();
        let monthName = summaryDateUtc.toLocaleString('default', { month: 'long' });
        let monthlyNotesTitle = `Monthly Summary by AI - ${monthYearStr} - ${monthName}`;

        const docs = await ModelLifeEvents.aggregate([
            {
                $match: {
                    username: username,
                    title: monthlyNotesTitle,
                },
            },
        ]);

        return docs.length > 0 ? docs[0] : null;
    } catch (error) {
        console.error(error);
        return null;
    }
};

const getLastMonthSummary = async (username: string): Promise<object | null> => {
    try {
        const lastMonth = DateTime.fromJSDate(new Date()).minus({ months: 1 }).toJSDate();

        const summaryDateUtc = new Date(lastMonth);
        let monthYearStr = summaryDateUtc.getFullYear().toString();
        let monthName = summaryDateUtc.toLocaleString('default', { month: 'long' });
        let monthlyNotesTitle = `Monthly Summary by AI - ${monthYearStr} - ${monthName}`;

        const docs = await ModelLifeEvents.aggregate([
            {
                $match: {
                    username: username,
                    title: monthlyNotesTitle,
                },
            },
        ]);

        return docs.length > 0 ? docs[0] : null;
    } catch (error) {
        console.error(error);
        return null;
    }
};

const getUserSummary = async (username: string): Promise<object | null> => {
    try {
        const [summaryToday, summaryYesterday, summaryCurrentWeek, summaryLastWeek, summaryCurrentMonth, summaryLastMonth] = await Promise.all([
            getTodaySummary(username),
            getYesterdaySummary(username),
            getCurrentWeekSummary(username),
            getLastWeekSummary(username),
            getCurrentMonthSummary(username),
            getLastMonthSummary(username),
        ]);

        return {
            summaryToday,
            summaryYesterday,
            summaryCurrentWeek,
            summaryLastWeek,
            summaryCurrentMonth,
            summaryLastMonth,
        };
    } catch (error) {
        console.error(error);
        return null;
    }
};

export {
    getUserSummary,
};