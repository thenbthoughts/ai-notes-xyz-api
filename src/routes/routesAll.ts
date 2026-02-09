import { Router, Request, Response } from 'express';

// dashboard
import routesDashboardSuggestTasks from './dashboard/dashboardSuggestTasks.route';
import routesDashboard from './dashboard/dashboard.route';

// user
import routeUserAuth from './user/userAuth.route';
import routeUserCrud from './user/userCrud.route';
import routeUserApiKey from './user/userApiKey.route';
import routeUserTimezoneRevalidate from './user/userTimezoneRevalidate.route';
import routeUserRevalidate from './user/userRevalidate.route';
import routeUserLoginHistory from './user/userLoginHistory';
import routeUserNotification from './user/userNotification.route';
import routeUserOpenaiCompatibleModel from './user/userOpenaiCompatibleModel.route';
import routeUserMemory from './user/userMemory.route';

// chat llm
import routesChatLlmCrud from './chatLlm/chatLlmCrud/chatLlmCrud.route';
import routesChatLlmAddChat from './chatLlm/chatLlmCrud/chatLlmAdd.route';
import routesChatLlmAiGeneratedNextQuestion from './chatLlm/chatLlmCrud/chatLlmAiGeneratedNextQuestion.route';
import routesChatLlmThreadsCrud from './chatLlm/chatLlmThreads/chatLlmThreadsCrud.route';
import routesChatLlmThreadsContextCrud from './chatLlm/chatLlmThreads/chatLlmThreadsContextCrud.route';
import routesChatLlmAddAutoNextMessage from './chatLlm/chatLlmCrud/chatLlmAddAutoNextMessage.route';
import routesChatLlmPolling from './chatLlm/chatLlmPolling/answerMachinePolling.route';

// dynamic data
import routesDynamicDataModelOpenrouter from './dynamicData/modelOpenrouter.route';
import routesDynamicDataModelGroq from './dynamicData/modelGroq.route';
import routesDynamicDataModelOllama from './dynamicData/modelOllama.route';

// page -> task
import routesTaskCrud from './task/taskCrud.route';
import routesTaskStatusList from './task/taskStatusList.route';
import routeTaskAiGenerated from './task/taskAiGenerated.route';
import routesTaskSub from './task/routesTaskSub.route';
import routesTaskWorkspaceCrud from './task/taskWorkspaceCrud.route';

// page -> task schedule
import routesTaskScheduleCrud from './taskSchedule/taskSchedule.route';

// page -> notes
import routesNotesCrud from './notes/notesCrud.route';
import routesNotesWorkspaceCrud from './notes/notesWorkspaceCrud.route';

// page -> info vault
import routesInfoVaultAll from './infoVault/infoVaultAll.route';

// page -> life events
import routesLifeEventsCrud from './lifeEvents/lifeEventsCrud/lifeEventsCrud.route';
import routesLifeEventCategoryCrud from './lifeEvents/lifeEventsCrud/lifeEventsCategoryCrud.route';
import routesLifeEventsAiCategoryCrud from './lifeEvents/lifeEventsCrud/lifeEventsAiCategoryCrud.route';

import uploadFileS3ForFeatures from './upload/uploadFileS3ForFeatures';

import llmTaskBackgroundProcessCrudRouter from './llmTaskBackgroundProcess/llmTaskBackgroundProcessCrud.route';

// llm crud
import routesLlmCrud from './llmCrud/llmCrud.route';

// maps
import routesMapsCrud from './maps/maps.route';

// calender
import routesCalenderCrud from './calender/calender.route';

// suggestions
import routesSuggestionsCrud from './suggestions/suggestionsCrud.route';

// common comments
import routesCommentCommonCrud from './commentCommon/commentCommon.route';

// search
import routesSearchCrud from './search/search.route';

// drive
import routesDrive from './drive/drive.route';

// ai context
import routesAiContextKeyword from './aiContext/aiContextKeyword';
import routesAiContextFaq from './aiContext/aiContextFaq';

// timeline
import routesTimeline from './timeline/timeline.route';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
    return res.send('Welcome to ai notes.');
});

// Add all routes here
router.use('/user/auth', routeUserAuth);
router.use('/user/crud', routeUserCrud);
router.use('/user/api-keys', routeUserApiKey);
router.use('/user/timezone-revalidate', routeUserTimezoneRevalidate);
router.use('/user/revalidate', routeUserRevalidate);
router.use('/user/login-history', routeUserLoginHistory);
router.use('/user/notification', routeUserNotification);
router.use('/user/openai-compatible-model/crud', routeUserOpenaiCompatibleModel);
router.use('/setting/user/memory', routeUserMemory);

// routes -> chat llm
router.use('/chat-llm/crud', routesChatLlmCrud);
router.use('/chat-llm/chat-add', routesChatLlmAddChat);
router.use('/chat-llm/ai-generated-next-questions', routesChatLlmAiGeneratedNextQuestion);
router.use('/chat-llm/threads-crud', routesChatLlmThreadsCrud);
router.use('/chat-llm/threads-context-crud', routesChatLlmThreadsContextCrud);
router.use('/chat-llm/add-auto-next-message', routesChatLlmAddAutoNextMessage);
router.use('/chat-llm/polling', routesChatLlmPolling);

// routes -> task
router.use('/task/crud', routesTaskCrud);
router.use('/task/ai-generated', routeTaskAiGenerated);
router.use('/task-sub/crud', routesTaskSub);
router.use('/task-status-list/crud', routesTaskStatusList);
router.use('/task-workspace/crud', routesTaskWorkspaceCrud);

// routes -> task schedule
router.use('/task-schedule/crud', routesTaskScheduleCrud);

// routes -> notes
router.use('/notes/crud', routesNotesCrud);
router.use('/notes-workspace/crud', routesNotesWorkspaceCrud);

// routes -> info vault
router.use('/info-vault', routesInfoVaultAll);

// router -> life events
router.use('/life-events/crud', routesLifeEventsCrud);
router.use('/life-events/category-crud', routesLifeEventCategoryCrud);
router.use('/life-events/ai-category-crud', routesLifeEventsAiCategoryCrud);

// uploads
router.use('/uploads/crud', uploadFileS3ForFeatures);

// llm task background process
router.use('/llm-task-background-process/crud', llmTaskBackgroundProcessCrudRouter);

// llm crud
router.use('/llm/crud', routesLlmCrud);

// dynamic data
router.use('/dynamic-data/model-openrouter', routesDynamicDataModelOpenrouter);
router.use('/dynamic-data/model-groq', routesDynamicDataModelGroq);
router.use('/dynamic-data/model-ollama', routesDynamicDataModelOllama);


// dashboard
router.use('/dashboard/suggest-tasks', routesDashboardSuggestTasks);
router.use('/dashboard/crud', routesDashboard);

// maps
router.use('/maps/crud', routesMapsCrud);

// routes -> calender
router.use('/calender/crud', routesCalenderCrud);

// routes -> suggestions
router.use('/suggestions/crud', routesSuggestionsCrud);

// routes -> common comments
router.use('/comment-common/crud', routesCommentCommonCrud);

// routes -> search
router.use('/search/crud', routesSearchCrud);

// routes -> drive
router.use('/drive', routesDrive);

// routes -> ai context
router.use('/ai-context/keyword', routesAiContextKeyword);
router.use('/ai-context/faq', routesAiContextFaq);

// routes -> timeline
router.use('/timeline/crud', routesTimeline);

/*
Example:
/api/user/auth/login
/api/user/auth/register
*/

export default router;
