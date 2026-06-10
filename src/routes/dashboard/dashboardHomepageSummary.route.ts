import { Router, Request, Response } from 'express';
import { ModelHomepageSummary } from '../../schema/schemaHomepageSummary/SchemaHomepageSummary.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { generateHomepageSummary } from './utils/generateHomepageSummary';

// Router
const router = Router();

// POST /generate - Generate a new homepage summary
router.post(
    '/generate',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const auth_userId = res.locals.auth_userId;

            // Generate the brief homepage summary using LLM
            const summaryText = await generateHomepageSummary(auth_userId);

            if (!summaryText || summaryText.trim().length === 0) {
                return res.status(400).json({
                    message: 'Could not generate summary. No sufficient data found.',
                });
            }

            // Create new homepage summary document
            const newSummary = await ModelHomepageSummary.create({
                userId: auth_userId,
                generatedAtUtc: new Date(),
                summary: summaryText,
            });

            return res.json({
                message: 'Homepage summary generated successfully',
                doc: newSummary,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// DELETE /clear-all - Delete all homepage summaries for the user
router.delete(
    '/clear-all',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const auth_userId = res.locals.auth_userId;

            const result = await ModelHomepageSummary.deleteMany({
                userId: auth_userId,
            });

            return res.json({
                message: 'All homepage summaries cleared successfully',
                deletedCount: result.deletedCount,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// GET /list - List summaries for user (sorted by generatedAtUtc desc, max 10)
router.get(
    '/list',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const auth_userId = res.locals.auth_userId;

            const docs = await ModelHomepageSummary.find({
                userId: auth_userId,
            })
                .sort({ generatedAtUtc: -1 })
                .limit(10)
                .exec();

            return res.json({
                message: 'Homepage summaries retrieved successfully',
                docs,
                total: docs.length,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

export default router;