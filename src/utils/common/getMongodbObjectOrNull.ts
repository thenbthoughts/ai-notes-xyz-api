import mongoose from "mongoose";

const getMongodbObjectOrNull = (id: string | null) => {
    if (!id) {
        return null;
    }
    if (typeof id !== 'string') {
        return null;
    }
    if (id.length !== 24) {
        return null;
    }
    return mongoose.Types.ObjectId.createFromHexString(id) || null;
}

export {
    getMongodbObjectOrNull,
};