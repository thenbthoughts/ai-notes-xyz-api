import mongoose from "mongoose";
import envKeys from "../../src/config/envKeys";

import answerMachineInitiateFunc from "../../src/routes/chatLlm/chatLlmCrud/answerMachineV2/answerMachineInitiateFunc";

const testAnswerMachine = async () => {
    console.log('testAnswerMachine');

    console.time('total-time');
    try {
        await mongoose.connect(envKeys.MONGODB_URI);
        console.log('mongoose connected');

        const resultAnswerMachine = await answerMachineInitiateFunc({
            messageId: new mongoose.Types.ObjectId('6991a891a1ba7ca8660eeb9f'),
        });
        console.log('resultAnswerMachine', resultAnswerMachine);

        console.log('answerMachineFunc done');
    } catch (error) {
        console.error('Error in test:', error);
    } finally {
        await mongoose.disconnect();
        console.timeEnd('total-time');
    }
};

testAnswerMachine();

// npx ts-node -r dotenv/config ./srcTest/2026-01-26-answer-machine/2026-01-26-answer-machine-2.ts