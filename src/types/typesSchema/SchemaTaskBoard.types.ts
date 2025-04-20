import { Document } from 'mongoose';

export interface tsTaskBoard extends Document {
    // fields
    boardName: string;

    // identification
    username: string;
}
