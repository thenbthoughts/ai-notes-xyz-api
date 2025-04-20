import { Router, Request, Response } from 'express';
import { ModelTaskBoard } from '../../schema/SchemaTaskBoard.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';

// Router
const router = Router();

// taskBoardAdd
router.post('/taskBoardAdd', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const { boardName } = req.body;

        const newTask = await ModelTaskBoard.create({
            boardName,
            username: res.locals.auth_username,
        });

        return res.status(201).json(newTask);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// taskBoardGet
router.post('/taskBoardGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const username = res.locals.auth_username;

        const resultTasks = await ModelTaskBoard.find({ username }).sort({ boardName: 1 });

        return res.json({
            message: 'Tasks board name retrieved successfully',
            count: resultTasks.length,
            docs: resultTasks,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// taskBoardEdit
router.post('/taskBoardEdit', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const { id, boardName } = req.body;
        const auth_username = res.locals.auth_username;

        const updatedTask = await ModelTaskBoard.findOneAndUpdate(
            {
                _id: id,
                username: auth_username,
            },
            {
                boardName,
            },
            {
                new: true,
            }
        );
        if (!updatedTask) {
            return res.status(404).json({ message: 'Task not found' });
        }
        return res.json(updatedTask);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// taskBoardDelete
router.post('/taskBoardDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const { id } = req.body;
        const auth_username = res.locals.auth_username;

        const deletedTask = await ModelTaskBoard.findOneAndDelete({
            _id: id,
            username: auth_username,
        });
        if (!deletedTask) {
            return res.status(404).json({ message: 'Task not found' });
        }
        return res.json({ message: 'Task deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;