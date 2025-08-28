import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { getTextFromAudioByUrlAndUsername } from '../../utils/llmPendingTask/utils/fetchAudioUnified';

const router = Router();

// Get text from audio by url
router.post('/audioToText', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const fileUrl = req.body.fileUrl;

        const result = await getTextFromAudioByUrlAndUsername({
            fileUrl: fileUrl,
            username: res.locals.auth_username,
        });

        if (result.error !== '') {
            return res.status(400).json(result);
        }

        return res.json(result);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;