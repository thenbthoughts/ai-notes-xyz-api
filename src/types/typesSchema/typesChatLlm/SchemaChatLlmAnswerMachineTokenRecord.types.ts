import mongoose, { Document } from 'mongoose';

export type AnswerMachineQueryType = 
    | 'question_generation' 
    | 'sub_question_answer' 
    | 'evaluation' 
    | 'final_answer';

export interface IChatLlmAnswerMachineTokenRecord extends Document {
    // identification
    _id: mongoose.Types.ObjectId;
    
    // reference to thread
    threadId: mongoose.Types.ObjectId;
    
    // query type
    queryType: AnswerMachineQueryType;
    
    // token counts for this single execution
    promptTokens: number;
    completionTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    costInUsd: number;
    
    // auth
    username: string;
    
    // auto
    createdAtUtc: Date;
}
