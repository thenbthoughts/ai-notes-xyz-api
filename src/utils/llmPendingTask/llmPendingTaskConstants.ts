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