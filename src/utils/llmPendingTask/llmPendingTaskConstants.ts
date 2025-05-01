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
    }
};

export {
    llmPendingTaskTypes,
};