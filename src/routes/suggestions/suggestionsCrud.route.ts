import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { generateDailySummaryByUserId } from '../../utils/llmPendingTask/page/taskSchedule/timeBasedSummary/generateDailySummaryByUserId';
import generateTaskSuggestionsFromConversations from './utils/generateTaskSuggestionsFromConversations';
import { generateWeeklySummaryByUserId } from '../../utils/llmPendingTask/page/taskSchedule/timeBasedSummary/generateWeeklySummaryByUserId';
import { generateMonthlySummaryByUserId } from '../../utils/llmPendingTask/page/taskSchedule/timeBasedSummary/generateMonthlySummaryByUserId';
import { getUserSummary } from './utils/getUserSummary';
import { getUserSummaryCombined } from './utils/getUserSummaryCombined';

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
                userId: res.locals.auth_userId,
                summaryDate: new Date(summaryDate),
            });
        } else if (summaryType === 'weekly') {
            await generateWeeklySummaryByUserId({
                userId: res.locals.auth_userId,
                summaryDate: new Date(summaryDate),
            });
        } else if (summaryType === 'monthly') {
            await generateMonthlySummaryByUserId({
                userId: res.locals.auth_userId,
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

// Get AI summary Combined
router.get('/get-ai-summary-combined', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;

        const userSummaryStr = await getUserSummaryCombined(userId);

        if (userSummaryStr.length <= 0) {
            return res.status(404).json({
                message: 'No summary found',
                data: {
                    userSummary: ''
                }
            });
        }

        return res.json({
            message: 'AI Summaries retrieved successfully',
            data: {
                userSummary: userSummaryStr,
            },
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Get AI Summary
router.get('/ai-summary-get', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;

        const userSummary = await getUserSummary(userId);

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
        let taskList = await generateTaskSuggestionsFromConversations({
            userId: res.locals.auth_userId,
        }) as Array<{
            taskPriority: string;
            taskWorkspaceId: string;
            taskWorkspaceName: string;
            taskTitle: string;
            taskDescription: string;
        }>;
        const priorityFilter = typeof req.query.priority === 'string' ? req.query.priority.trim().toLowerCase() : '';
        const workspaceFilter = typeof req.query.workspace === 'string' ? req.query.workspace.trim() : '';
        const workspaceIdFilter = typeof req.query.workspaceId === 'string' ? req.query.workspaceId.trim() : '';
        const searchFilter = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
        const pageRaw = typeof req.query.page === 'string' ? parseInt(req.query.page, 10) : 1;
        const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 0;
        if (priorityFilter && ['high', 'medium', 'low'].includes(priorityFilter)) {
            taskList = taskList.filter((t) => {
                return String(t.taskPriority).toLowerCase() === priorityFilter;
            });
        }
        if (workspaceIdFilter) {
            taskList = taskList.filter((t) => {
                return String(t.taskWorkspaceId) === workspaceIdFilter;
            });
        } else if (workspaceFilter) {
            const wf = workspaceFilter.toLowerCase();
            taskList = taskList.filter((t) => {
                return String(t.taskWorkspaceName).toLowerCase().includes(wf);
            });
        }
        if (searchFilter) {
            taskList = taskList.filter((t) => {
                const hay = `${t.taskTitle} ${t.taskDescription}`.toLowerCase();
                return hay.includes(searchFilter);
            });
        }
        const total = taskList.length;
        const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 100 ? limitRaw : total || 20;
        const start = (page - 1) * limit;
        const paged = limitRaw > 0 ? taskList.slice(start, start + limit) : taskList;
        return res.status(201).json({
            success: 'Success',
            error: '',
            data: {
                count: total,
                docs: paged,
                page,
                limit,
                totalPages: limit > 0 ? Math.ceil(total / limit) : 1,
            }
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/dismiss-task-suggestion', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const { suggestionId, taskTitle } = req.body as { suggestionId?: string; taskTitle?: string };
        if (!suggestionId && !taskTitle) {
            return res.status(400).json({ message: 'suggestionId or taskTitle is required' });
        }
        return res.json({ message: 'Suggestion dismissed', data: { suggestionId: suggestionId || taskTitle } });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;