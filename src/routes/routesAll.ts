import { Router, Request, Response } from 'express';
import routeUserAuth from './user/userAuth.route';
import routeUserCrud from './user/userCrud.route';
import routeUserApiKey from './user/userApiKey.route';
import routeUserTimezoneRevalidate from './user/userTimezoneRevalidate.route';

import routesChatOneCrud from './chatOne/chatOneCrud.route';
import routesChatOneAddChat from './chatOne/chatOneAdd.route';
import routesChatOneAiGeneratedNextQuestion from './chatOne/chatOneAiGeneratedNextQuestion.route';

import routesTaskCrud from './task/taskCrud.route';
import routesTaskBoard from './task/taskBoard.route';
import routesTaskBoardList from './task/taskBoardList.route';
import routeTaskAiGenerated from './task/taskAiGenerated.route';
import routesTaskSub from './task/routesTaskSub.route';
import routesTaskComments from './task/routesTaskComments.route';

import routesMemoCrud from './memo/memoCrud.route';

import uploadFileS3 from './upload/uploadFileS3';

import apiKeyDefault from './apiKeyDefault/apiKeyDefault.route';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
    return res.send('Welcome to ai notes.');
});

// Add all routes here
router.use('/user/auth', routeUserAuth);
router.use('/user/crud', routeUserCrud);
router.use('/user/api-keys', routeUserApiKey);
router.use('/user/timezone-revalidate', routeUserTimezoneRevalidate);

// routes -> chat
router.use('/chat-one/crud', routesChatOneCrud);
router.use('/chat-one/chat-add', routesChatOneAddChat);
router.use('/chat-one/ai-generated-next-questions', routesChatOneAiGeneratedNextQuestion);

// routes -> task
router.use('/task/crud', routesTaskCrud);
router.use('/task/ai-generated', routeTaskAiGenerated);
router.use('/task-sub/crud', routesTaskSub);
router.use('/task-board/crud', routesTaskBoard);
router.use('/task-board-list/crud', routesTaskBoardList);
router.use('/task-comments/crud', routesTaskComments);

// memo -> 
router.use('/memos/crud', routesMemoCrud);

// uploads
router.use('/uploads/crudS3', uploadFileS3);

// other
router.use('/apiKeyDefault/crud', apiKeyDefault);

/*
Example:
/api/user/auth/login
/api/user/auth/register
*/

export default router;
