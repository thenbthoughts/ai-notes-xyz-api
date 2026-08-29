import mongoose, { Schema, Document } from 'mongoose';

// Record Empty Table
export interface IRecordEmptyTable extends Document {
    // fields
    tableName: string;
};

// Record Empty Table Schema
const recordEmptyTableSchema = new Schema<IRecordEmptyTable>({
    // fields
    tableName: { type: String, required: true, default: '' },
});

// Record Empty Table Model
const ModelRecordEmptyTable = mongoose.model<IRecordEmptyTable>(
    'recordEmptyTable',
    recordEmptyTableSchema,
    'recordEmptyTable'
);

export {
    ModelRecordEmptyTable
};