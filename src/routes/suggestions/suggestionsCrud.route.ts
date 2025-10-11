import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { generateDailySummaryByUserId } from '../../utils/llmPendingTask/page/taskSchedule/timeBasedSummary/generateDailySummaryByUserId';
import generateTaskSuggestionsFromConversations from './utils/generateTaskSuggestionsFromConversations';
import { generateWeeklySummaryByUserId } from '../../utils/llmPendingTask/page/taskSchedule/timeBasedSummary/generateWeeklySummaryByUserId';
import { generateMonthlySummaryByUserId } from '../../utils/llmPendingTask/page/taskSchedule/timeBasedSummary/generateMonthlySummaryByUserId';
import { getUserSummary } from './utils/getUserSummary';

const router = Router();

// Generate AI Daily Diary
router.post('/ai-daily-diary-revalidate', middlewareUserAuth, async (req: Request, res: Response) => {
    const {
        summaryDate,
        summaryType,
    } = req.body;

    try {

        // validate summary type
        if (
            summaryType === 'daily'
            || summaryType === 'weekly'
            || summaryType === 'monthly'
        ) {
            // valid
        } else {
            return res.status(400).json({ message: 'Invalid summary type' });
        }

        // validate summary date
        if (!summaryDate || isNaN(new Date(summaryDate).getTime())) {
            return res.status(400).json({ message: 'Summary date is required' });
        }

        if (summaryType === 'daily') {
            await generateDailySummaryByUserId({
                username: res.locals.auth_username,
                summaryDate: new Date(summaryDate),
            });
        } else if (summaryType === 'weekly') {
            await generateWeeklySummaryByUserId({
                username: res.locals.auth_username,
                summaryDate: new Date(summaryDate),
            });
        } else if (summaryType === 'monthly') {
            await generateMonthlySummaryByUserId({
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

router.get('/ai-summary-get', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const username = res.locals.auth_username;

        const userSummary = await getUserSummary(username);

        return res.json({
            message: 'AI Summaries retrieved successfully',
            data: userSummary,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Get AI Task
router.get('/get-ai-task-suggestions', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let taskList = [] as object[];
        taskList = await generateTaskSuggestionsFromConversations({
            username: res.locals.auth_username,
        });

        return res.status(201).json({
            success: 'Success',
            error: '',
            data: {
                count: taskList.length,
                docs: taskList,
            }
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;