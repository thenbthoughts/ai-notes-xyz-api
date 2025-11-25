import mongoose, { Document } from 'mongoose';

export interface IGlobalSearch extends Document {
    // Search fields
    text: string; // lowercase concatenated searchable text
    ngram: string[]; // array of ngrams for partial matching

    // Reference fields
    entityId: mongoose.Schema.Types.ObjectId;
    username: string;
    collectionName: '' | 'tasks' | 'notes' | 'lifeEvents' | 'infoVault' | 'chatLlmThread';

    // Metadata fields for filtering
    taskIsCompleted: boolean;
    taskIsArchived: boolean;
    taskWorkspaceId: mongoose.Schema.Types.ObjectId;
    notesWorkspaceId: mongoose.Schema.Types.ObjectId;
    lifeEventIsDiary: boolean;

    // Sorting
    updatedAtUtc: Date;
}

