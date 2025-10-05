import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelLifeEvents } from '../../schema/schemaLifeEvents/SchemaLifeEvents.schema';
import { generateDailySummaryByUserId } from '../../utils/llmPendingTask/page/taskSchedule/timeBasedSummary/generateDailySummaryByUserId';

const router = Router();

// Generate AI Daily Diary
router.post('/ai-daily-diary-revalidate', middlewareUserAuth, async (req: Request, res: Response) => {
    const {
        summaryDate,
        summaryType,
    } = req.body;

    try {

        // validate summary type
        if(summaryType === 'daily') {
            // valid
        } else {
            return res.status(400).json({ message: 'Invalid summary type' });
        }

        // validate summary date
        if(!summaryDate || isNaN(new Date(summaryDate).getTime())) {
            return res.status(400).json({ message: 'Summary date is required' });
        }

        if(summaryType === 'daily') {
            await generateDailySummaryByUserId({
                username: res.locals.auth_username,
                summaryDate: new Date(summaryDate),
            });
        }

        return res.json({
            message: 'AI Daily Diary - Today Summary generated successfully',
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Get AI Daily Diary - Today Summary
router.get('/ai-daily-diary-get-today-summary', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let todayDateUtc = new Date();
        let summaryDateOnly = new Date(todayDateUtc).toISOString().split('T')[0];
        let dailyNotesTitle = `Daily Summary by AI - ${summaryDateOnly}`;

        const docs = await ModelLifeEvents.aggregate([
            {
                $match: {
                    username: res.locals.auth_username,
                    title: dailyNotesTitle,
                },
            },
        ]);

        const totalCount = docs.length;

        return res.json({
            message: 'AI Daily Diary - Today Summary retrieved successfully',
            count: totalCount,
            docs: docs,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Get AI Daily Diary - Yesterday Summary
router.get('/ai-daily-diary-get-yesterday-summary', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let todayDateUtc = new Date(
            new Date().valueOf() - 24 * 60 * 60 * 1000
        );
        let summaryDateOnly = new Date(todayDateUtc).toISOString().split('T')[0];
        let dailyNotesTitle = `Daily Summary by AI - ${summaryDateOnly}`;

        const docs = await ModelLifeEvents.aggregate([
            {
                $match: {
                    username: res.locals.auth_username,
                    title: dailyNotesTitle,
                },
            },
        ]);

        const totalCount = docs.length;

        return res.json({
            message: 'AI Daily Diary - Today Summary retrieved successfully',
            count: totalCount,
            docs: docs,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;