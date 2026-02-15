import mongoose from "mongoose";
import { ModelAnswerMachineSubQuestion } from "../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineSubQuestions.schema";

export interface SubQuestionRecord {
    _id?: mongoose.Types.ObjectId;
    answerMachineId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId | null;
    parentMessageId: mongoose.Types.ObjectId | null;
    username: string;
    question: string;
    answer?: string;
    contextIds?: mongoose.Types.ObjectId[];
    status: 'pending' | 'answered' | 'error' | 'skipped';
    errorReason?: string;
    createdAtUtc?: Date | null;
    updatedAtUtc?: Date | null;
}

/**
 * Repository for Sub-Question database operations
 */
export class SubQuestionRepository {

    /**
     * Create a new sub-question record
     */
    static async create(record: Omit<SubQuestionRecord, '_id' | 'createdAtUtc' | 'updatedAtUtc'>): Promise<mongoose.Types.ObjectId> {
        const subQuestion = await ModelAnswerMachineSubQuestion.create({
            ...record,
            createdAtUtc: new Date(),
            updatedAtUtc: new Date(),
        });

        return subQuestion._id;
    }

    /**
     * Create multiple sub-questions at once
     */
    static async createMany(
        records: Omit<SubQuestionRecord, '_id' | 'createdAtUtc' | 'updatedAtUtc'>[]
    ): Promise<mongoose.Types.ObjectId[]> {
        const subQuestions = await ModelAnswerMachineSubQuestion.insertMany(
            records.map(record => ({
                ...record,
                createdAtUtc: new Date(),
                updatedAtUtc: new Date(),
            }))
        );

        return subQuestions.map(sq => sq._id);
    }

    /**
     * Find sub-question by ID
     */
    static async findById(id: mongoose.Types.ObjectId): Promise<SubQuestionRecord | null> {
        return await ModelAnswerMachineSubQuestion.findById(id);
    }

    /**
     * Find all pending sub-questions for an answer machine
     */
    static async findPendingByAnswerMachineId(answerMachineId: mongoose.Types.ObjectId): Promise<SubQuestionRecord[]> {
        return await ModelAnswerMachineSubQuestion.find({
            answerMachineId,
            status: 'pending',
        });
    }

    /**
     * Find all answered sub-questions for an answer machine
     */
    static async findAnsweredByAnswerMachineId(answerMachineId: mongoose.Types.ObjectId): Promise<SubQuestionRecord[]> {
        return await ModelAnswerMachineSubQuestion.find({
            answerMachineId,
            status: 'answered',
        });
    }

    /**
     * Find all sub-questions for an answer machine
     */
    static async findByAnswerMachineId(answerMachineId: mongoose.Types.ObjectId): Promise<SubQuestionRecord[]> {
        return await ModelAnswerMachineSubQuestion.find({ answerMachineId })
            .sort({ createdAtUtc: 1 });
    }

    /**
     * Update sub-question with answer and context
     */
    static async updateWithAnswer(
        id: mongoose.Types.ObjectId,
        answer: string,
        contextIds: mongoose.Types.ObjectId[]
    ): Promise<void> {
        await ModelAnswerMachineSubQuestion.findByIdAndUpdate(id, {
            $set: {
                answer,
                contextIds,
                status: 'answered',
                updatedAtUtc: new Date(),
            }
        });
    }

    /**
     * Update sub-question status to error
     */
    static async updateWithError(
        id: mongoose.Types.ObjectId,
        errorReason: string
    ): Promise<void> {
        await ModelAnswerMachineSubQuestion.findByIdAndUpdate(id, {
            $set: {
                status: 'error',
                errorReason,
                updatedAtUtc: new Date(),
            }
        });
    }

    /**
     * Delete all sub-questions for a thread
     */
    static async deleteByThreadId(threadId: mongoose.Types.ObjectId, username: string): Promise<void> {
        await ModelAnswerMachineSubQuestion.deleteMany({
            threadId,
            username,
        });
    }

    /**
     * Count sub-questions by status for an answer machine
     */
    static async countByStatus(
        answerMachineId: mongoose.Types.ObjectId
    ): Promise<{
        pending: number;
        answered: number;
        error: number;
        total: number;
    }> {
        const result = await ModelAnswerMachineSubQuestion.aggregate([
            { $match: { answerMachineId } },
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 }
                }
            }
        ]);

        const counts = { pending: 0, answered: 0, error: 0, total: 0 };

        result.forEach(item => {
            if (item._id in counts) {
                counts[item._id as keyof typeof counts] = item.count;
                counts.total += item.count;
            }
        });

        return counts;
    }

    /**
     * Get sub-questions with answers for final answer generation
     */
    static async getAnsweredQuestionsForFinalAnswer(answerMachineId: mongoose.Types.ObjectId): Promise<Array<{
        question: string;
        answer: string;
    }>> {
        const subQuestions = await this.findAnsweredByAnswerMachineId(answerMachineId);
        return subQuestions.map(sq => ({
            question: sq.question,
            answer: sq.answer || '',
        }));
    }
}