import { ModelLifeEvents } from '../../../schema/schemaLifeEvents/SchemaLifeEvents.schema';
import { DateTime } from 'luxon';
import { ModelUser } from '../../../schema/schemaUser/SchemaUser.schema';
import IUser from '../../../types/typesSchema/typesUser/SchemaUser.types';
import { ILifeEvents } from '../../../types/typesSchema/typesLifeEvents/SchemaLifeEvents.types';

const getTodaySummary = async (userId: string): Promise<ILifeEvents | null> => {
    try {
        let todayDateUtc = new Date();
        let summaryDateOnly = new Date(todayDateUtc).toISOString().split('T')[0];
        let dailyNotesTitle = `Daily Summary by AI - ${summaryDateOnly}`;

        const docs = await ModelLifeEvents.aggregate([
            {
                $match: {
                    userId: userId,
                    title: dailyNotesTitle,
                },
            },
        ]) as ILifeEvents[];

        return docs.length > 0 ? docs[0] : null;
    } catch (error) {
        console.error(error);
        return null;
    }
};

const getYesterdaySummary = async (userId: string): Promise<ILifeEvents | null> => {
    try {
        let yesterdayDateUtc = new Date(new Date().valueOf() - 24 * 60 * 60 * 1000);
        let summaryDateOnly = new Date(yesterdayDateUtc).toISOString().split('T')[0];
        let dailyNotesTitle = `Daily Summary by AI - ${summaryDateOnly}`;

        const docs = await ModelLifeEvents.aggregate([
            {
                $match: {
                    userId: userId,
                    title: dailyNotesTitle,
                },
            },
        ]) as ILifeEvents[];

        return docs.length > 0 ? docs[0] : null;
    } catch (error) {
        console.error(error);
        return null;
    }
};

const getCurrentWeekSummary = async (userId: string): Promise<ILifeEvents | null> => {
    try {
        const userRecords = await ModelUser.findById(userId) as IUser[];
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
                    userId: userId,
                    title: weeklyNotesTitle,
                },
            },
        ]) as ILifeEvents[];

        return docs.length > 0 ? docs[0] : null;
    } catch (error) {
        console.error(error);
        return null;
    }
};

const getLastWeekSummary = async (userId: string): Promise<ILifeEvents | null> => {
    try {
        const userRecords = await ModelUser.findById(userId) as IUser[];
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
                    userId: userId,
                    title: weeklyNotesTitle,
                },
            },
        ]) as ILifeEvents[];

        return docs.length > 0 ? docs[0] : null;
    } catch (error) {
        console.error(error);
        return null;
    }
};

const getCurrentMonthSummary = async (userId: string): Promise<ILifeEvents | null> => {
    try {
        const summaryDateUtc = new Date();
        let monthYearStr = summaryDateUtc.getFullYear().toString();
        let monthName = summaryDateUtc.toLocaleString('default', { month: 'long' });
        let monthlyNotesTitle = `Monthly Summary by AI - ${monthYearStr} - ${monthName}`;

        const docs = await ModelLifeEvents.aggregate([
            {
                $match: {
                    userId: userId,
                    title: monthlyNotesTitle,
                },
            },
        ]) as ILifeEvents[];

        return docs.length > 0 ? docs[0] : null;
    } catch (error) {
        console.error(error);
        return null;
    }
};

const getLastMonthSummary = async (userId: string): Promise<ILifeEvents | null> => {
    try {
        const lastMonth = DateTime.fromJSDate(new Date()).minus({ months: 1 }).toJSDate();

        const summaryDateUtc = new Date(lastMonth);
        let monthYearStr = summaryDateUtc.getFullYear().toString();
        let monthName = summaryDateUtc.toLocaleString('default', { month: 'long' });
        let monthlyNotesTitle = `Monthly Summary by AI - ${monthYearStr} - ${monthName}`;

        const docs = await ModelLifeEvents.aggregate([
            {
                $match: {
                    userId: userId,
                    title: monthlyNotesTitle,
                },
            },
        ]) as ILifeEvents[];

        return docs.length > 0 ? docs[0] : null;
    } catch (error) {
        console.error(error);
        return null;
    }
};

const getUserSummary = async (userId: string): Promise<{
    summaryToday: ILifeEvents | null,
    summaryYesterday: ILifeEvents | null,
    summaryCurrentWeek: ILifeEvents | null,
    summaryLastWeek: ILifeEvents | null,
    summaryCurrentMonth: ILifeEvents | null,
    summaryLastMonth: ILifeEvents | null,
}> => {
    try {
        const [summaryToday, summaryYesterday, summaryCurrentWeek, summaryLastWeek, summaryCurrentMonth, summaryLastMonth] = await Promise.all([
            getTodaySummary(userId),
            getYesterdaySummary(userId),
            getCurrentWeekSummary(userId),
            getLastWeekSummary(userId),
            getCurrentMonthSummary(userId),
            getLastMonthSummary(userId),
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
        return {
            summaryToday: null,
            summaryYesterday: null,
            summaryCurrentWeek: null,
            summaryLastWeek: null,
            summaryCurrentMonth: null,
            summaryLastMonth: null,
        };
    }
};

export {
    getUserSummary,
};