import mongoose, { Document } from 'mongoose';

export interface tsTaskList extends Document{
    // Todo specific fields
    title: string;
    description: string;
    dueDate: Date;
    checklist: string[];
    comments: string[];
    
    // status
    priority: '' | 'very-low' | 'low' | 'medium' | 'high' | 'very-high';
    isArchived: boolean;
    isCompleted: boolean;

    // labels
    labels: string[];
    labelsAi: string[];

    // identification
    taskWorkspaceId: mongoose.Types.ObjectId | null;
    taskStatusId: mongoose.Types.ObjectId | null;

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
