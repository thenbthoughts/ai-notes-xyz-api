import mongoose, { Document } from 'mongoose';

export interface tsTaskListScheduleSendMyselfEmail extends Document {
    // auth
    username: string;

    // identification
    taskScheduleId: mongoose.Types.ObjectId;

    // email fields -> staticContent
    emailSubject: string;
    emailContent: string;
    
    // ai fields -> aiConversationMail
    aiEnabled: boolean;
    passAiContextEnabled: boolean;
    systemPrompt: string;
    userPrompt: string;

    // model info
    aiModelName: string;
    aiModelProvider: string;
}
