const llmPendingTaskTypes = {
    page: {
        // Consolidated Feature AI Actions - runs all AI actions together (FAQ, Summary, Tags, Embedding)
        featureAiActions: {
            chatThread: 'featureAiActions_chatThread',
            chatMessage: 'featureAiActions_chatMessage',
            notes: 'featureAiActions_notes',
            task: 'featureAiActions_task',
            lifeEvents: 'featureAiActions_lifeEvents',
            infoVault: 'featureAiActions_infoVault',
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
    }
};

export {
    llmPendingTaskTypes,
};