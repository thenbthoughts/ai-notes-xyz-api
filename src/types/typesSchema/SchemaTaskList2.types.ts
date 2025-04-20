import { Document } from 'mongoose';

export interface tsTaskList extends Document{
    // Todo specific fields
    title: string;
    description: string;
    priority: '' | 'low' | 'medium' | 'high';
    dueDate: Date;
    checklist: string[];
    comments: string[];

    // labels
    labels: string[];
    labelsAi: string[];

    // identification
    boardName: string;
    taskStatus: string;

    // auth
    username: string;

    // auto
    createdAtUtc: Date;
    createdAtIpAddress: string;
    createdAtUserAgent: string;
    updatedAtUtc: Date;
    updatedAtIpAddress: string;
    updatedAtUserAgent: string;
}
