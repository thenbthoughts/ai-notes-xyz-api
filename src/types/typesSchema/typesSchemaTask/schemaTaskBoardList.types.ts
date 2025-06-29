import { Document } from 'mongoose';

export interface tsTaskBoardList extends Document {
    // fields
    boardName: string;
    boardListName: string;
    listPosition: number;

    // identification
    username: string;
}
