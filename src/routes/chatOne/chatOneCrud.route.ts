import { Router, Request, Response } from 'express';
import { ModelChatOne } from '../../schema/SchemaChatOne.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { PipelineStage } from 'mongoose';

// Router
const router = Router();

// Get Note API
router.post('/notesGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        // variables
        let search = '';
        if (typeof req.body?.search === 'string') {
            search = req.body?.search;
        }

        let paginationDateLocalYearMonthStr = '';
        if (typeof req.body?.paginationDateLocalYearMonthStr === 'string') {
            const tempPaginationDateLocalYearMonthStr = req.body.paginationDateLocalYearMonthStr;
            if (tempPaginationDateLocalYearMonthStr.split('-').length === 2) {
                paginationDateLocalYearMonthStr = tempPaginationDateLocalYearMonthStr;
            }
        }

        let tempStage = {} as PipelineStage;
        const stateDocument = [] as PipelineStage[];

        // stateDocument -> match
        const tempStageMatch = {
            username: res.locals.auth_username,
        } as {
            username: string;
            content?: RegExp;
            paginationDateLocalYearMonthStr?: string;
        };
        if (typeof search === 'string') {
            if (search.length >= 1) {
                tempStageMatch.content = new RegExp(search, 'i');
            }
        }
        if (paginationDateLocalYearMonthStr !== '') {
            tempStageMatch.paginationDateLocalYearMonthStr = paginationDateLocalYearMonthStr;
        }
        tempStage = {
            $match: {
                ...tempStageMatch,
            }
        }
        stateDocument.push(tempStage);

        // stateDocument -> sort
        tempStage = {
            $sort: {
                createdAtUtc: 1,
            }
        }
        stateDocument.push(tempStage);

        // pipeline
        const resultNotes = await ModelChatOne.aggregate(stateDocument);

        return res.json({
            message: 'Notes retrieved successfully',
            count: resultNotes.length,
            docs: resultNotes,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Get search api
router.post('/notesGetSearch', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        // variables
        let search = '';
        if (typeof req.body?.search === 'string') {
            search = req.body?.search;
        }

        let searchIndex = 0;
        if (typeof req.body?.searchIndex === 'number') {
            const tempSearchIndex = req.body?.searchIndex;
            if (tempSearchIndex >= 0) {
                searchIndex = tempSearchIndex
            }
        }

        // return 200 response if search is empty
        if (search === '') {
            return res.json({
                message: 'Notes retrieved successfully',
                count: 0,
                docs: [],
            });
        }

        let tempStage = {} as PipelineStage;
        const stateDocument = [] as PipelineStage[];
        const stateCount = [] as PipelineStage[];

        // stateDocument -> match
        tempStage = {
            $match: {
                username: res.locals.auth_username,
                content: new RegExp(search, 'i'),
            }
        }
        stateDocument.push(tempStage);
        stateCount.push(tempStage);

        // stateDocument -> sort
        tempStage = {
            $sort: {
                createdAtUtc: -1,
            }
        }
        stateDocument.push(tempStage);

        // stateDocument -> skip
        tempStage = {
            $skip: searchIndex,
        }
        stateDocument.push(tempStage);

        // stateDocument -> limit
        tempStage = {
            $limit: 1,
        }
        stateDocument.push(tempStage);

        // stageCount -> count
        tempStage = {
            $count: 'count',
        }
        stateCount.push(tempStage);

        // get total count
        const resultTotalCount = await ModelChatOne.aggregate(stateCount).exec();
        let totalCount = 0;
        if (resultTotalCount.length > 0 && resultTotalCount[0].count) {
            totalCount = resultTotalCount[0].count;
        }

        // pipeline
        const resultNotes = await ModelChatOne.aggregate(stateDocument);

        return res.json({
            message: 'Notes retrieved successfully',
            count: totalCount,
            docs: resultNotes,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Get Group by
// TODO

// Edit Note API
router.post('/notesEdit', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const { id, userAgent, updatedAtIpAddress, ...updateData } = req.body;
        const updatedNote = await ModelChatOne.findByIdAndUpdate(id, { ...updateData, userAgent, updatedAtIpAddress }, { new: true });
        if (!updatedNote) {
            return res.status(404).json({ message: 'Note not found' });
        }
        return res.json(updatedNote);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Delete Note API
router.post('/notesDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const deletedNote = await ModelChatOne.findByIdAndDelete(req.body.id);
        if (!deletedNote) {
            return res.status(404).json({ message: 'Note not found' });
        }
        return res.json({ message: 'Note deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;