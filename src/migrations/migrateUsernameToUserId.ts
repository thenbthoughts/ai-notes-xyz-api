import mongoose, { Types } from 'mongoose';

import { ModelUser } from '../schema/schemaUser/SchemaUser.schema';

const LOG_PREFIX = '[migrateUsernameToUserId]';

/** `username` on the user collection is the login handle — never migrate it. */
const SKIP_COLLECTIONS = new Set(['user']);

type LegacyUsernamePath = {
    usernamePath: string;
    userIdPath: string;
};

/** Nested legacy `username` paths beyond the top-level field. */
const NESTED_LEGACY_USERNAME_PATHS: Record<string, LegacyUsernamePath[]> = {
    chatLlm: [{ usernamePath: 'shellRunArtifactV1.username', userIdPath: 'shellRunArtifactV1.userId' }],
};

function normalizeUsername(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim().toLowerCase();
    return trimmed.length > 0 ? trimmed : null;
}

async function buildUsernameToObjectIdMap(): Promise<Map<string, Types.ObjectId>> {
    const users = await ModelUser.find({}).select('username').lean();
    const map = new Map<string, Types.ObjectId>();

    for (const user of users) {
        const username = normalizeUsername(user.username);
        if (!username || !user._id) {
            continue;
        }
        map.set(username, new Types.ObjectId(String(user._id)));
    }

    return map;
}

async function dropLegacyUsernameIndexes(collectionName: string): Promise<string[]> {
    const db = mongoose.connection.db;
    if (!db) {
        return [];
    }

    const collection = db.collection(collectionName);
    const dropped: string[] = [];

    try {
        const indexes = await collection.indexes();
        for (const index of indexes) {
            const keys = Object.keys(index.key ?? {});
            if (keys.length === 1 && keys[0] === 'username') {
                const indexName = index.name;
                if (indexName) {
                    await collection.dropIndex(indexName);
                    dropped.push(indexName);
                }
            }
        }
    } catch {
        /* collection may not exist or indexes unavailable */
    }

    return dropped;
}

async function migrateStringUserIdToObjectId(collectionName: string): Promise<number> {
    const db = mongoose.connection.db;
    if (!db) {
        return 0;
    }

    const collection = db.collection(collectionName);
    const stringUserIdDocs = await collection
        .find({ userId: { $type: 'string' } })
        .project({ _id: 1, userId: 1 })
        .toArray();

    let updated = 0;

    for (const doc of stringUserIdDocs) {
        const rawUserId = doc.userId;
        if (typeof rawUserId !== 'string' || !Types.ObjectId.isValid(rawUserId)) {
            continue;
        }

        const objectId = new Types.ObjectId(rawUserId);
        const result = await collection.updateOne(
            { _id: doc._id },
            { $set: { userId: objectId } }
        );
        updated += result.modifiedCount;
    }

    return updated;
}

async function migrateLegacyUsernameToUserId(params: {
    collectionName: string;
    usernamePath: string;
    userIdPath: string;
    usernameMap: Map<string, Types.ObjectId>;
}): Promise<number> {
    const { collectionName, usernamePath, userIdPath, usernameMap } = params;
    const db = mongoose.connection.db;
    if (!db) {
        return 0;
    }

    const collection = db.collection(collectionName);
    let updated = 0;

    for (const [loginHandle, objectId] of usernameMap) {
        const result = await collection.updateMany(
            {
                [usernamePath]: loginHandle,
                [userIdPath]: { $exists: false },
            },
            { $set: { [userIdPath]: objectId } }
        );

        updated += result.modifiedCount;
    }

    return updated;
}

function getLegacyUsernamePaths(collectionName: string): LegacyUsernamePath[] {
    const paths: LegacyUsernamePath[] = [
        { usernamePath: 'username', userIdPath: 'userId' },
    ];

    const nested = NESTED_LEGACY_USERNAME_PATHS[collectionName];
    if (nested) {
        paths.push(...nested);
    }

    return paths;
}

/**
 * Populates `userId` from legacy login-handle strings stored in `username`.
 * The `username` field is left unchanged. Skips rows that already have `userId`.
 */
export async function migrateUsernameToUserId(): Promise<void> {
    if (mongoose.connection.readyState !== 1) {
        throw new Error('MongoDB is not connected');
    }

    const db = mongoose.connection.db;
    if (!db) {
        throw new Error('MongoDB database handle is unavailable');
    }

    const startedAt = Date.now();
    const usernameMap = await buildUsernameToObjectIdMap();

    if (usernameMap.size === 0) {
        console.log(`${LOG_PREFIX} No users found — skipping migration.`);
        return;
    }

    const collectionInfos = await db.listCollections().toArray();
    let totalUpdated = 0;
    let collectionsTouched = 0;

    for (const collectionInfo of collectionInfos) {
        const collectionName = collectionInfo.name;
        if (SKIP_COLLECTIONS.has(collectionName) || collectionName.startsWith('system.')) {
            continue;
        }

        const legacyPaths = getLegacyUsernamePaths(collectionName);

        const droppedIndexes = await dropLegacyUsernameIndexes(collectionName);
        if (droppedIndexes.length > 0) {
            console.log(
                `${LOG_PREFIX} ${collectionName}: dropped legacy username index(es): ${droppedIndexes.join(', ')}`
            );
        }

        let collectionUpdated = 0;

        for (const pathPair of legacyPaths) {
            const pathUpdated = await migrateLegacyUsernameToUserId({
                collectionName,
                usernamePath: pathPair.usernamePath,
                userIdPath: pathPair.userIdPath,
                usernameMap,
            });
            collectionUpdated += pathUpdated;
        }

        const stringUserIdUpdated = await migrateStringUserIdToObjectId(collectionName);
        collectionUpdated += stringUserIdUpdated;

        if (collectionUpdated > 0) {
            collectionsTouched += 1;
            console.log(`${LOG_PREFIX} ${collectionName}: updated ${collectionUpdated} document(s)`);
        }

        totalUpdated += collectionUpdated;
    }

    const elapsedMs = Date.now() - startedAt;
    console.log(
        `${LOG_PREFIX} Completed in ${elapsedMs}ms — ${totalUpdated} document(s) updated across ${collectionsTouched} collection(s).`
    );
}

export default migrateUsernameToUserId;