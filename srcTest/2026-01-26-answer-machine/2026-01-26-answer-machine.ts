import mongoose from "mongoose";
import envKeys from "../../src/config/envKeys";

import answerMachineFunc from "../../src/routes/chatLlm/chatLlmCrud/answerMachine/answerMachineFunc";

const testAnswerMachine = async () => {
    console.log('testAnswerMachine');

    console.time('total-time');
    try {
        await mongoose.connect(envKeys.MONGODB_URI);
        console.log('mongoose connected');

        console.time('answer-machine-time');
        const resultAnswerMachine = await answerMachineFunc({
            threadId: new mongoose.Types.ObjectId('6991748766aef359155a76d1'),
            username: 'nibf',
        });
        console.timeEnd('answer-machine-time');
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

// npx ts-node -r dotenv/config ./srcTest/2026-01-26-answer-machine/2026-01-26-answer-machine.ts