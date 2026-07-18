import mongoose from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelCommentCommon } from '../../schema/schemaCommentCommon/SchemaCommentCommon.schema';
import { ModelChatLlm } from '../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelMemoFile } from '../../schema/schemaMemo/SchemaMemoFile.schema';
import { ModelInfoVault } from '../../schema/schemaInfoVault/SchemaInfoVault.schema';

const router = Router();

type TimelineFileDoc = {
    _id: string;
    sourceRecordId: string;
    fileType: string;
    fileUrl: string;
    fileTitle: string;
    fileDescription: string;
    sourceType: string;
    parentEntityType: string;
    parentEntityId: string;
    createdAtUtc: Date | null;
    updatedAtUtc: Date | null;
};

const toId = (value: unknown) => {
    if (value instanceof mongoose.Types.ObjectId) return value.toString();
    if (typeof value === 'string') return value;
    return value != null ? String(value) : '';
};

const basenameFromPath = (path: string) => {
    if (!path) return '';
    const parts = path.split('/');
    return parts[parts.length - 1] || path;
};

const fileTypeFromPath = (path: string) => {
    const ext = (path.split('.').pop() || '').toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico'].includes(ext)) return 'image';
    if (['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv', 'm4v'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext)) return 'audio';
    return 'file';
};

const chatTypeToMediaType = (type: string, fileUrl: string) => {
    if (type === 'image' || type === 'video' || type === 'audio') return type;
    if (type === 'document' || type === 'file') return 'file';
    return fileTypeFromPath(fileUrl);
};

const sortByUpdatedDesc = (a: TimelineFileDoc, b: TimelineFileDoc) => {
    const aTime = new Date(a.updatedAtUtc || a.createdAtUtc || 0).getTime();
    const bTime = new Date(b.updatedAtUtc || b.createdAtUtc || 0).getTime();
    return bTime - aTime;
};

router.post('/timelineFilesGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let page = 1;
        let perPage = 24;

        if (typeof req.body?.page === 'number' && req.body.page >= 1) {
            page = req.body.page;
        }
        if (typeof req.body?.perPage === 'number' && req.body.perPage >= 1) {
            perPage = Math.min(req.body.perPage, 100);
        }

        const fileTypeFilter =
            typeof req.body?.fileType === 'string' ? req.body.fileType.trim().toLowerCase() : '';

        const userId = res.locals.auth_userId;

        const [commentRows, chatRows, memoRows, infoVaultRows] = await Promise.all([
            ModelCommentCommon.find({
                userId,
                fileUrl: { $exists: true, $nin: [null, ''] },
                fileType: { $exists: true, $nin: [null, ''] },
            })
                .select({
                    fileType: 1,
                    fileUrl: 1,
                    fileTitle: 1,
                    fileDescription: 1,
                    commentType: 1,
                    entityId: 1,
                    createdAtUtc: 1,
                    updatedAtUtc: 1,
                })
                .lean(),
            ModelChatLlm.find({
                userId,
                fileUrl: { $exists: true, $nin: [null, ''] },
            })
                .select({
                    type: 1,
                    content: 1,
                    fileUrl: 1,
                    fileUrlArr: 1,
                    threadId: 1,
                    createdAtUtc: 1,
                    updatedAtUtc: 1,
                })
                .lean(),
            ModelMemoFile.find({
                userId,
                filePath: { $exists: true, $nin: [null, ''] },
            })
                .select({
                    filePath: 1,
                    memoNoteId: 1,
                    createdAtUtc: 1,
                })
                .lean(),
            ModelInfoVault.find({
                userId,
                photoUrl: { $exists: true, $nin: [null, ''] },
            })
                .select({
                    photoUrl: 1,
                    name: 1,
                    notes: 1,
                    createdAtUtc: 1,
                    updatedAtUtc: 1,
                })
                .lean(),
        ]);

        const docs: TimelineFileDoc[] = [];

        for (const row of commentRows) {
            const fileUrl = typeof row.fileUrl === 'string' ? row.fileUrl : '';
            if (!fileUrl) continue;
            docs.push({
                _id: toId(row._id),
                sourceRecordId: toId(row._id),
                fileType: String(row.fileType || 'file'),
                fileUrl,
                fileTitle: String(row.fileTitle || basenameFromPath(fileUrl) || 'Attachment'),
                fileDescription: String(row.fileDescription || ''),
                sourceType: 'comment',
                parentEntityType: String(row.commentType || ''),
                parentEntityId: toId(row.entityId),
                createdAtUtc: row.createdAtUtc || null,
                updatedAtUtc: row.updatedAtUtc || row.createdAtUtc || null,
            });
        }

        for (const row of chatRows) {
            const urls: string[] = [];
            if (typeof row.fileUrl === 'string' && row.fileUrl) {
                urls.push(row.fileUrl);
            }
            if (Array.isArray(row.fileUrlArr)) {
                for (const url of row.fileUrlArr) {
                    if (typeof url === 'string' && url && !urls.includes(url)) {
                        urls.push(url);
                    }
                }
            }

            for (let i = 0; i < urls.length; i++) {
                const fileUrl = urls[i];
                const fileType =
                    i === 0
                        ? chatTypeToMediaType(String(row.type || ''), fileUrl)
                        : fileTypeFromPath(fileUrl);
                docs.push({
                    _id: `${toId(row._id)}-${i}`,
                    sourceRecordId: toId(row._id),
                    fileType,
                    fileUrl,
                    fileTitle: String(row.content || basenameFromPath(fileUrl) || 'Chat file'),
                    fileDescription: String(row.content || ''),
                    sourceType: 'chat',
                    parentEntityType: 'chatLlmThread',
                    parentEntityId: toId(row.threadId),
                    createdAtUtc: row.createdAtUtc || null,
                    updatedAtUtc: row.updatedAtUtc || row.createdAtUtc || null,
                });
            }
        }

        for (const row of memoRows) {
            const fileUrl = typeof row.filePath === 'string' ? row.filePath : '';
            if (!fileUrl) continue;
            docs.push({
                _id: toId(row._id),
                sourceRecordId: toId(row._id),
                fileType: fileTypeFromPath(fileUrl),
                fileUrl,
                fileTitle: basenameFromPath(fileUrl) || 'Memo file',
                fileDescription: '',
                sourceType: 'memo',
                parentEntityType: 'memo',
                parentEntityId: toId(row.memoNoteId),
                createdAtUtc: row.createdAtUtc || null,
                updatedAtUtc: row.createdAtUtc || null,
            });
        }

        for (const row of infoVaultRows) {
            const fileUrl = typeof row.photoUrl === 'string' ? row.photoUrl : '';
            if (!fileUrl) continue;
            docs.push({
                _id: toId(row._id),
                sourceRecordId: toId(row._id),
                fileType: 'image',
                fileUrl,
                fileTitle: String(row.name || 'Photo'),
                fileDescription: String(row.notes || ''),
                sourceType: 'infoVault',
                parentEntityType: 'infoVault',
                parentEntityId: toId(row._id),
                createdAtUtc: row.createdAtUtc || null,
                updatedAtUtc: row.updatedAtUtc || row.createdAtUtc || null,
            });
        }

        let filtered = docs;
        if (fileTypeFilter && ['image', 'video', 'audio', 'file'].includes(fileTypeFilter)) {
            filtered = docs.filter((doc) => doc.fileType === fileTypeFilter);
        }

        filtered.sort(sortByUpdatedDesc);

        const totalCount = filtered.length;
        const start = (page - 1) * perPage;
        const pageDocs = filtered.slice(start, start + perPage);

        return res.json({
            message: 'Timeline files retrieved successfully',
            docs: pageDocs,
            count: totalCount,
            page,
            perPage,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;
