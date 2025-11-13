const llmPendingTaskTypes = {
    page: {
        chat: {
            // chat threads
            generateChatThreadTitleById: 'pageChat_generateChatThreadTitleById',

            // chat
            generateChatTagsById: 'pageChat_generateChatTagsById',
            generateAudioById: 'pageChat_generateAudioById',
            generateNextResponseById: 'pageChat_generateNextResponseById',
        },

        lifeEvents: {
            // life events
            generateLifeEventAiSummaryById: 'pageLifeEvents_generateLifeEventAiSummaryById',
            generateLifeEventAiTagsById: 'pageLifeEvents_generateLifeEventAiTagsById',
            generateLifeEventAiCategoryById: 'pageLifeEvents_generateLifeEventAiCategoryById',
        },

        // notes
        notes: {
            generateNoteAiSummaryById: 'pageNotes_generateNoteAiSummaryById',
            generateNoteAiTagsById: 'pageNotes_generateNoteAiTagsById',

            // vector db index by notes id
            generateEmbeddingByNotesId: 'pageNotes_generateEmbeddingByNotesId',
        },

        // task
        task: {
            generateEmbeddingByTaskId: 'pageTask_generateEmbeddingByTaskId',
        },

        // task schedule
        taskSchedule: {
            taskSchedule_taskAdd: 'pageTaskSchedule_taskAdd',
            taskSchedule_notesAdd: 'pageTaskSchedule_notesAdd',
            taskSchedule_restApiCall: 'pageTaskSchedule_restApiCall',
            taskSchedule_suggestDailyTasksByAi: 'pageTaskSchedule_suggestDailyTasksByAi',
            taskSchedule_sendMyselfEmail: 'pageTaskSchedule_sendMyselfEmail',

            taskSchedule_generateDailySummaryByUserId: 'pageTaskSchedule_generateDailySummaryByUserId',
            taskSchedule_generateWeeklySummaryByUserId: 'pageTaskSchedule_generateWeeklySummaryByUserId',
            taskSchedule_generateMonthlySummaryByUserId: 'pageTaskSchedule_generateMonthlySummaryByUserId',
            taskSchedule_generateYearlySummaryByUserId: 'pageTaskSchedule_generateYearlySummaryByUserId',
        },

        // settings
        settings: {
            openRouterModelGet: 'pageSettings_openRouterModelGet',
            groqModelGet: 'pageSettings_groqModelGet',
        },

        // llmContext
        llmContext: {
            generateKeywordsBySourceId: 'pageLlmContext_generateKeywordsBySourceId',
        },
    }
};

export {
    llmPendingTaskTypes,
};