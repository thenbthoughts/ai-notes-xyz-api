import mongoose, { Document } from 'mongoose';

export interface IChatLlmAnswerMachineOpencodeRecord extends Document {
    _id: mongoose.Types.ObjectId;
    answerMachineRecordId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    username: string;
    summary: string;
    requestList: string[];
    conversation: string;
    createdAtUtc: Date;
    updatedAtUtc: Date;
}
