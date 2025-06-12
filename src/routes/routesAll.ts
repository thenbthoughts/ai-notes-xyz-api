import { Router, Request, Response } from 'express';
import routeUserAuth from './user/userAuth.route';
import routeUserCrud from './user/userCrud.route';
import routeUserApiKey from './user/userApiKey.route';
import routeUserTimezoneRevalidate from './user/userTimezoneRevalidate.route';

// chat
import routesChatOneCrud from './chatOne/chatOneCrud.route';
import routesChatOneAddChat from './chatOne/chatOneAdd.route';
import routesChatOneAiGeneratedNextQuestion from './chatOne/chatOneAiGeneratedNextQuestion.route';

// chat llm
import routesChatLlmCrud from './chatLlm/chatLlmCrud/chatLlmCrud.route';
import routesChatLlmAddChat from './chatLlm/chatLlmCrud/chatLlmAdd.route';
import routesChatLlmAiGeneratedNextQuestion from './chatLlm/chatLlmCrud/chatLlmAiGeneratedNextQuestion.route';
import routesChatLlmThreadsCrud from './chatLlm/chatLlmThreads/chatLlmThreadsCrud.route';

// page -> task
import routesTaskCrud from './task/taskCrud.route';
import routesTaskBoard from './task/taskBoard.route';
import routesTaskBoardList from './task/taskBoardList.route';
import routeTaskAiGenerated from './task/taskAiGenerated.route';
import routesTaskSub from './task/routesTaskSub.route';
import routesTaskComments from './task/routesTaskComments.route';

// page -> life events
import routesLifeEventsCrud from './lifeEvents/lifeEventsCrud/lifeEventsCrud.route';
import routesLifeEventCategoryCrud from './lifeEvents/lifeEventsCrud/lifeEventsCategoryCrud.route';
import routesLifeEventFileUploadCrud from './lifeEvents/lifeEventsCrud/lifeEventsFileUploadCrud.route';

import routesMemoCrud from './memo/memoCrud.route';

import uploadFileS3 from './upload/uploadFileS3';

import apiKeyDefault from './apiKeyDefault/apiKeyDefault.route';

import llmTaskBackgroundProcessCrudRouter from './llmTaskBackgroundProcess/llmTaskBackgroundProcessCrud.route';

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

// routes -> chat llm
router.use('/chat-llm/crud', routesChatLlmCrud);
router.use('/chat-llm/chat-add', routesChatLlmAddChat);
router.use('/chat-llm/ai-generated-next-questions', routesChatLlmAiGeneratedNextQuestion);
router.use('/chat-llm/threads-crud', routesChatLlmThreadsCrud);

// routes -> task
router.use('/task/crud', routesTaskCrud);
router.use('/task/ai-generated', routeTaskAiGenerated);
router.use('/task-sub/crud', routesTaskSub);
router.use('/task-board/crud', routesTaskBoard);
router.use('/task-board-list/crud', routesTaskBoardList);
router.use('/task-comments/crud', routesTaskComments);

// router -> life events
router.use('/life-events/crud', routesLifeEventsCrud);
router.use('/life-events/category-crud', routesLifeEventCategoryCrud);
router.use('/life-events/file-upload-crud', routesLifeEventFileUploadCrud);

// memo -> 
router.use('/memos/crud', routesMemoCrud);

// uploads
router.use('/uploads/crudS3', uploadFileS3);

// other
router.use('/apiKeyDefault/crud', apiKeyDefault);

// llm task background process
router.use('/llm-task-background-process/crud', llmTaskBackgroundProcessCrudRouter);

/*
Example:
/api/user/auth/login
/api/user/auth/register
*/

export default router;
