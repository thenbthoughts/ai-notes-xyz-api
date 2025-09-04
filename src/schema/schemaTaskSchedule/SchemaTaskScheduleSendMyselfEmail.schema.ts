import mongoose, { Schema } from 'mongoose';
import { tsTaskListScheduleSendMyselfEmail } from '../../types/typesSchema/typesSchemaTaskSchedule/SchemaTaskListScheduleSendMyselfEmail.types';

const taskScheduleSendMyselfEmailSchema = new Schema<tsTaskListScheduleSendMyselfEmail>({
    // auth
    username: {
        type: String,
        required: true,
        default: '',
        index: true,
    },

    // identification
    taskScheduleId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
    },

    // email fields -> staticContent
    emailSubject: {
        type: String,
        default: '',
    },
    emailContent: {
        type: String,
        default: '',
    },
    
    // ai fields -> aiConversationMail
    aiEnabled: {
        type: Boolean,
        default: false,
    },
    passAiContextEnabled: {
        type: Boolean,
        default: false,
    },
    systemPrompt: {
        type: String,
        default: '',
    },
    userPrompt: {
        type: String,
        default: '',
    },

    // model info
    aiModelName: {
        type: String,
        default: '',
    },
    aiModelProvider: {
        type: String,
        default: '',
    },
});

const ModelTaskScheduleSendMyselfEmail = mongoose.model<tsTaskListScheduleSendMyselfEmail>(
    'taskScheduleSendMyselfEmail',
    taskScheduleSendMyselfEmailSchema,
    'taskScheduleSendMyselfEmail'
);

export {
    ModelTaskScheduleSendMyselfEmail
};