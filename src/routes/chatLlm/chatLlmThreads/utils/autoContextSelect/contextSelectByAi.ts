/*
Steps:
1. generate by keywords by last 5 conversation
2. search topic in search keywords, faq

Prerequisites:
1. Keyword table
2. Faq table
*/

const contextSelectByAi = async ({
    threadId,
}: {
    threadId: string;
}) => {
    try {
        console.log('contextSelectByAi');
    } catch (error) {
        console.error(error);
        return false;
    }
};

export default contextSelectByAi;