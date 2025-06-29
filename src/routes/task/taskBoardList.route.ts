import { Router, Request, Response } from 'express';
import { ModelTaskBoardList } from '../../schema/schemaTask/SchemaTaskBoardList.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';

// Router
const router = Router();

// Add Task Board List API
router.post('/taskBoardListAdd', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const auth_username = res.locals.auth_username;
        const { boardName, boardListName, listPosition } = req.body;

        const newTaskBoardList = await ModelTaskBoardList.create({
            boardName,
            boardListName,
            listPosition,
            username: auth_username,
        });

        await revalidatePositionAll({
            auth_username,
        });

        return res.status(201).json(newTaskBoardList);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Get Task Board List API
router.post('/taskBoardListGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const username = res.locals.auth_username;

        const resultTaskBoardLists = await ModelTaskBoardList.find({ username }).sort({ listPosition: 1 });

        return res.json({
            message: 'Task board list retrieved successfully',
            count: resultTaskBoardLists.length,
            docs: resultTaskBoardLists,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Edit Task Board List API
router.post('/taskBoardListEdit', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const { id, boardName, boardListName, listPosition } = req.body;
        const auth_username = res.locals.auth_username;

        const updatedTaskBoardList = await ModelTaskBoardList.findOneAndUpdate(
            {
                _id: id,
                username: auth_username,
            },
            {
                boardName,
                boardListName,
                listPosition,
            },
            {
                new: true,
            }
        );
        if (!updatedTaskBoardList) {
            return res.status(404).json({ message: 'Task board list not found' });
        }

        await revalidatePositionAll({
            auth_username,
        });

        return res.json(updatedTaskBoardList);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Delete Task Board List API
router.post('/taskBoardListDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const { id } = req.body;
        const auth_username = res.locals.auth_username;

        const deletedTaskBoardList = await ModelTaskBoardList.findOneAndDelete({
            _id: id,
            username: auth_username,
        });
        if (!deletedTaskBoardList) {
            return res.status(404).json({ message: 'Task board list not found' });
        }

        await revalidatePositionAll({
            auth_username,
        });

        return res.json({ message: 'Task board list deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

const revalidatePositionAll = async ({
    auth_username
}: {
    auth_username: string;
}) => {
    try {
        const result = await ModelTaskBoardList.aggregate([
            {
                $match: {
                    username: auth_username,
                }
            },
            {
                $sort: {
                    listPosition: 1,
                }
            },
        ]);

        for (let index = 0; index < result.length; index++) {
            const element = result[index];
            if(element.listPosition !== index+1 ) {
                await ModelTaskBoardList.findByIdAndUpdate(
                    element._id,
                    { listPosition: index + 1 }, // Update the listPosition
                    { new: true } // Return the updated document
                );
            }
        }
    } catch (error) {
        console.error(error);
    }
};

// Task Board List Revalidate Position by ID API
router.post('/taskBoardListRevalidatePositionById', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const { _id, upOrDown } = req.body;
        const auth_username = res.locals.auth_username;

        const taskBoardList = await ModelTaskBoardList.findById(_id);
        if (!taskBoardList) {
            return res.status(400).json({ message: 'Task board list not found' });
        }

        const currentPosition = taskBoardList.listPosition;
        const newPosition = upOrDown === 'up' ? currentPosition - 1 : currentPosition + 1;

        const targetTaskBoardList = await ModelTaskBoardList.findOne({ listPosition: newPosition });
        if (targetTaskBoardList) {
            await ModelTaskBoardList.findByIdAndUpdate(
                targetTaskBoardList._id,
                { listPosition: currentPosition },
                { new: true }
            );
        }

        await ModelTaskBoardList.findByIdAndUpdate(
            _id,
            { listPosition: newPosition },
            { new: true }
        );

        await revalidatePositionAll({
            auth_username,
        });

        return res.json({ message: `Task board list moved ${upOrDown} successfully` });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;