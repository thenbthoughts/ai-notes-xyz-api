import { Router, Request, Response } from 'express';
import mongoose, { PipelineStage } from 'mongoose';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelFaq } from '../../schema/schemaFaq/SchemaFaq.schema';

const router = Router();

// List AI Context FAQs with aggregation
router.post('/list', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const auth_username = res.locals.auth_username;

        let tempStage = {} as PipelineStage;
        const pipelineDocument = [] as PipelineStage[];
        const pipelineCount = [] as PipelineStage[];

        const page = parseInt(req.body?.page as string) || 1;
        const limit = parseInt(req.body?.limit as string) || 50;
        const skip = (page - 1) * limit;

        const sourceType = req.body?.sourceType as string;
        const sourceId = req.body?.sourceId as string;
        const question = req.body?.question as string;
        const answer = req.body?.answer as string;
        const aiCategory = req.body?.aiCategory as string;
        const aiSubCategory = req.body?.aiSubCategory as string;
        const tags = req.body?.tags as string[];

        // stage -> match -> filters
        let matchStage = {
            username: auth_username
        } as {
            username: string;
            metadataSourceType?: string;
            metadataSourceId?: mongoose.Types.ObjectId;
            question?: { $regex: string; $options: string };
            answer?: { $regex: string; $options: string };
            aiCategory?: { $regex: string; $options: string };
            aiSubCategory?: { $regex: string; $options: string };
            tags?: { $in: string[] };
        };

        if (sourceType) {
            matchStage.metadataSourceType = sourceType;
        }

        if (sourceId) {
            const sourceIdObj = mongoose.Types.ObjectId.isValid(sourceId)
                ? new mongoose.Types.ObjectId(sourceId)
                : null;
            if (sourceIdObj) {
                matchStage.metadataSourceId = sourceIdObj;
            }
        }

        if (question) {
            matchStage.question = { $regex: question, $options: 'i' };
        }

        if (answer) {
            matchStage.answer = { $regex: answer, $options: 'i' };
        }

        if (aiCategory) {
            matchStage.aiCategory = { $regex: aiCategory, $options: 'i' };
        }

        if (aiSubCategory) {
            matchStage.aiSubCategory = { $regex: aiSubCategory, $options: 'i' };
        }

        if (tags && Array.isArray(tags) && tags.length > 0) {
            matchStage.tags = { $in: tags };
        }

        // stage -> match
        tempStage = { $match: matchStage };
        pipelineDocument.push(tempStage);
        pipelineCount.push(tempStage);

        // stage -> sort
        tempStage = { $sort: { createdAtUtc: -1 } };
        pipelineDocument.push(tempStage);

        // stage -> skip
        tempStage = { $skip: skip };
        pipelineDocument.push(tempStage);

        // stage -> limit
        tempStage = { $limit: limit };
        pipelineDocument.push(tempStage);

        // stage -> project
        tempStage = {
            $project: {
                _id: 1,
                username: 1,
                question: 1,
                answer: 1,
                aiCategory: 1,
                aiSubCategory: 1,
                tags: 1,
                metadataSourceType: 1,
                metadataSourceId: 1,
                hasEmbedding: 1,
                isActive: 1,
                createdAtUtc: 1,
                updatedAtUtc: 1,
            }
        };
        pipelineDocument.push(tempStage);

        // stageCount -> count
        tempStage = { $count: 'total' };
        pipelineCount.push(tempStage);

        const [faqsResult, totalResult] = await Promise.all([
            ModelFaq.aggregate(pipelineDocument),
            ModelFaq.aggregate(pipelineCount)
        ]);

        const total = totalResult.length > 0 ? totalResult[0].total : 0;

        return res.json({
            message: 'FAQs retrieved successfully',
            count: total,
            docs: faqsResult,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error listing AI context FAQs:', error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;

