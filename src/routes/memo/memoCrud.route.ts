import { Router, Request, Response } from 'express';
import type { Types } from 'mongoose';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelMemoLabel } from '../../schema/schemaMemo/SchemaMemoLabel.schema';
import { ModelMemoFile } from '../../schema/schemaMemo/SchemaMemoFile.schema';
import { ModelMemoNote } from '../../schema/schemaMemo/SchemaMemoNote.schema';
import { getMongodbObjectOrNull } from '../../utils/common/getMongodbObjectOrNull';
import { mergeMemoFilePathsAndLegacyDoc, deleteAllMemoFilesAndLegacyStorage } from './memoImageShared';
import { reindexDocument } from '../../utils/search/reindexGlobalSearch';
import { ModelGlobalSearch } from '../../schema/schemaGlobalSearch/SchemaGlobalSearch.schema';

const router = Router();

const MAX_LABELS_PER_NOTE = 25;

const ALLOWED_NOTE_COLORS = new Set([
  '',
  'coral',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'pink',
  'brown',
  'gray',
]);

function parseNoteColor(noteColorInput: unknown): { ok: true; value: string } | { ok: false; message: string } {
  if (noteColorInput === undefined || noteColorInput === null) return { ok: true, value: '' };
  if (typeof noteColorInput !== 'string') return { ok: false, message: 'noteColor must be a string' };
  const trimmedNoteColor = noteColorInput.trim();
  if (!ALLOWED_NOTE_COLORS.has(trimmedNoteColor)) return { ok: false, message: 'noteColor is invalid' };
  return { ok: true, value: trimmedNoteColor };
}

function parseReminderTime(input: unknown): { ok: true; value: Date | null } | { ok: false; message: string } {
  if (input === undefined || input === null || input === '') return { ok: true, value: null };
  if (typeof input === 'string' || typeof input === 'number') {
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) return { ok: false, message: 'reminderTime is invalid' };
    return { ok: true, value: d };
  }
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return { ok: false, message: 'reminderTime is invalid' };
    return { ok: true, value: input };
  }
  return { ok: false, message: 'reminderTime is invalid' };
}

type MemoDocPlain = {
  _id: Types.ObjectId;
  userId: string;
  title?: string;
  body?: string;
  labelIds?: Types.ObjectId[];
  pinned?: boolean;
  archived?: boolean;
  trashed?: boolean;
  sortOrder?: number;
  noteColor?: string;
  reminderTime?: Date | null;
  createdAtUtc?: Date;
  createdAtIpAddress?: string;
  createdAtUserAgent?: string;
  updatedAtUtc?: Date;
  updatedAtIpAddress?: string;
  updatedAtUserAgent?: string;
};

function effectiveLabelObjectIds(doc: MemoDocPlain | Record<string, unknown>): Types.ObjectId[] {
  const rawArr = doc.labelIds as Types.ObjectId[] | undefined;
  if (!Array.isArray(rawArr) || rawArr.length === 0) return [];
  const out: Types.ObjectId[] = [];
  const seen = new Set<string>();
  for (const id of rawArr) {
    if (!id) continue;
    const s = id.toHexString();
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(id);
  }
  return out;
}

async function assertLabelsOwned(userId: string, ids: Types.ObjectId[]) {
  if (ids.length === 0) {
    return true;
  }
  const count = await ModelMemoLabel.countDocuments({ userId, _id: { $in: ids } });
  return count === ids.length;
}

async function parseAndValidateLabelIds(
  userId: string,
  labelIdsInput: unknown,
): Promise<{ ok: true; ids: Types.ObjectId[] } | { ok: false; message: string }> {
  if (labelIdsInput === undefined) {
    return { ok: true, ids: [] };
  }
  if (labelIdsInput === null) {
    return { ok: true, ids: [] };
  }
  if (!Array.isArray(labelIdsInput)) {
    return { ok: false, message: 'labelIds must be an array' };
  }
  const ids: Types.ObjectId[] = [];
  const seen = new Set<string>();
  for (const labelIdItem of labelIdsInput) {
    const oid = getMongodbObjectOrNull(labelIdItem);
    if (!oid) continue;
    const s = oid.toHexString();
    if (seen.has(s)) continue;
    seen.add(s);
    ids.push(oid);
    if (ids.length > MAX_LABELS_PER_NOTE) {
      return { ok: false, message: `At most ${MAX_LABELS_PER_NOTE} labels per memo` };
    }
  }
  if (!(await assertLabelsOwned(userId, ids))) {
    return { ok: false, message: 'One or more labels were not found' };
  }
  return { ok: true, ids };
}

async function enrichNoteDoc(
  doc: MemoDocPlain | null,
): Promise<(MemoDocPlain & { labelNames: string[]; imageDataUrls: string[] }) | null> {
  if (!doc || !doc._id) return null;
  const rawDoc = doc as Record<string, unknown>;
  const slim = rawDoc as MemoDocPlain;
  const userId = String(doc.userId ?? '');
  const ids = effectiveLabelObjectIds(doc);
  const lbls = ids.length ? await ModelMemoLabel.find({ userId, _id: { $in: ids } }).lean() : [];
  const labelNames = ids.map((id) => lbls.find((l) => String(l._id) === String(id))?.name ?? '');
  const files = await ModelMemoFile.find({ userId, memoNoteId: doc._id }).sort({ sortOrder: 1, createdAtUtc: 1 }).lean();
  const pathsFromFiles = files.map((f) => f.filePath);
  return {
    ...slim,
    labelIds: ids,
    labelNames,
    imageDataUrls: mergeMemoFilePathsAndLegacyDoc(pathsFromFiles, rawDoc),
  };
}

router.post('/memoList', middlewareUserAuth, async (req: Request, res: Response) => {
  try {
    const memoLabelResolutionStages = [
      {
        $addFields: {
          effectiveMemoLabelIds: { $ifNull: ['$labelIds', []] },
        },
      },
      {
        $lookup: {
          from: 'memoLabels',
          let: { ids: '$effectiveMemoLabelIds', user: '$userId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $in: ['$_id', '$$ids'] }, { $eq: ['$userId', '$$user'] }],
                },
              },
            },
            { $project: { _id: 1, name: 1 } },
          ],
          as: 'memoLabelsFromLookup',
        },
      },
      {
        $addFields: {
          labelNames: {
            $cond: {
              if: { $gt: [{ $size: '$effectiveMemoLabelIds' }, 0] },
              then: {
                $map: {
                  input: '$effectiveMemoLabelIds',
                  as: 'labelId',
                  in: {
                    $let: {
                      vars: {
                        matchedLabel: {
                          $arrayElemAt: [
                            {
                              $filter: {
                                input: '$memoLabelsFromLookup',
                                as: 'lookupRow',
                                cond: { $eq: ['$$lookupRow._id', '$$labelId'] },
                              },
                            },
                            0,
                          ],
                        },
                      },
                      in: { $ifNull: ['$$matchedLabel.name', ''] },
                    },
                  },
                },
              },
              else: [],
            },
          },
          labelIds: '$effectiveMemoLabelIds',
        },
      },
      {
        $project: {
          memoLabelsFromLookup: 0,
          effectiveMemoLabelIds: 0,
        },
      },
    ];

    const userId = res.locals.auth_userId as string;
    const limit =
      typeof req.body?.limit === 'number' && req.body.limit >= 1 && req.body.limit <= 2000
        ? req.body.limit
        : 1000;

    const docs = await ModelMemoNote.aggregate([
      { $match: { userId } },
      { $sort: { sortOrder: -1, updatedAtUtc: -1 } },
      { $limit: limit },
      ...memoLabelResolutionStages,
    ]);

    const noteIds = docs.map((d) => d._id as Types.ObjectId);
    const fileRows =
      noteIds.length > 0
        ? await ModelMemoFile.find({ userId, memoNoteId: { $in: noteIds } })
            .sort({ sortOrder: 1, createdAtUtc: 1 })
            .lean()
        : [];
    const pathsByMemo = new Map<string, string[]>();
    for (const fr of fileRows) {
      const key = String(fr.memoNoteId);
      if (!pathsByMemo.has(key)) pathsByMemo.set(key, []);
      pathsByMemo.get(key)!.push(fr.filePath);
    }

    const docsOut = docs.map((d) => {
      const rec = d as Record<string, unknown>;
      const pathsFromFiles = pathsByMemo.get(String(d._id)) ?? [];
      return {
        ...rec,
        imageDataUrls: mergeMemoFilePathsAndLegacyDoc(pathsFromFiles, rec),
      };
    });

    return res.json({
      message: 'Memos retrieved successfully',
      docs: docsOut,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.post('/memoAdd', middlewareUserAuth, async (req: Request, res: Response) => {
  try {
    const userId = res.locals.auth_userId as string;
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    const pinned = req.body?.pinned === true;

    const parsed = await parseAndValidateLabelIds(userId, req.body?.labelIds);
    if (!parsed.ok) {
      return res.status(400).json({ message: parsed.message });
    }
    const labelIds = parsed.ids;

    const nc = parseNoteColor(req.body?.noteColor);
    if (!nc.ok) {
      return res.status(400).json({ message: nc.message });
    }

    if (!title && !body) {
      return res.status(400).json({ message: 'Title or body is required' });
    }

    const rt = parseReminderTime(req.body?.reminderTime);
    if (!rt.ok) {
      return res.status(400).json({ message: rt.message });
    }

    const now = new Date();
    const created = await ModelMemoNote.create({
      userId,
      title: title || '',
      body,
      labelIds,
      pinned,
      archived: false,
      trashed: false,
      sortOrder: now.getTime(),
      noteColor: nc.value,
      reminderTime: rt.value,
      createdAtUtc: now,
      createdAtIpAddress: req.ip || '',
      createdAtUserAgent: req.headers['user-agent'] || '',
      updatedAtUtc: now,
      updatedAtIpAddress: req.ip || '',
      updatedAtUserAgent: req.headers['user-agent'] || '',
    });

    const lean = created.toObject<MemoDocPlain>();
    const doc = await enrichNoteDoc(lean);

    await reindexDocument({
      reindexDocumentArr: [{ collectionName: 'memoNotes', documentId: String(created._id) }],
    });

    return res.json({
      message: 'Memo added successfully',
      doc,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.post('/memoEdit', middlewareUserAuth, async (req: Request, res: Response) => {
  try {
    const userId = res.locals.auth_userId as string;
    const _id = getMongodbObjectOrNull(req.body?._id);
    if (!_id) {
      return res.status(400).json({ message: 'Memo ID is invalid' });
    }

    const updateObj: Record<string, unknown> = {
      updatedAtUtc: new Date(),
      updatedAtIpAddress: req.ip || '',
      updatedAtUserAgent: req.headers['user-agent'] || '',
    };

    if (typeof req.body?.title === 'string') {
      updateObj.title = req.body.title;
    }
    if (typeof req.body?.body === 'string') {
      updateObj.body = req.body.body;
    }
    if (typeof req.body?.pinned === 'boolean') {
      updateObj.pinned = req.body.pinned;
    }
    if (typeof req.body?.sortOrder === 'number' && Number.isFinite(req.body.sortOrder)) {
      updateObj.sortOrder = req.body.sortOrder;
    }
    if (typeof req.body?.archived === 'boolean') {
      updateObj.archived = req.body.archived;
    }
    if (typeof req.body?.trashed === 'boolean') {
      updateObj.trashed = req.body.trashed;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'noteColor')) {
      const nc = parseNoteColor(req.body.noteColor);
      if (!nc.ok) {
        return res.status(400).json({ message: nc.message });
      }
      updateObj.noteColor = nc.value;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'labelIds')) {
      const parsed = await parseAndValidateLabelIds(userId, req.body.labelIds);
      if (!parsed.ok) {
        return res.status(400).json({ message: parsed.message });
      }
      updateObj.labelIds = parsed.ids;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'reminderTime')) {
      const rt2 = parseReminderTime(req.body.reminderTime);
      if (!rt2.ok) {
        return res.status(400).json({ message: rt2.message });
      }
      updateObj.reminderTime = rt2.value;
    }
    const updatePayload: { $set: Record<string, unknown> } = { $set: updateObj };
    const result = await ModelMemoNote.updateOne({ _id, userId }, updatePayload);

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Memo not found or unauthorized' });
    }

    await reindexDocument({
      reindexDocumentArr: [{ collectionName: 'memoNotes', documentId: _id.toString() }],
    });

    return res.json({ message: 'Memo updated successfully' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.post('/memoDelete', middlewareUserAuth, async (req: Request, res: Response) => {
  try {
    const userId = res.locals.auth_userId as string;
    const _id = getMongodbObjectOrNull(req.body?._id);
    if (!_id) {
      return res.status(400).json({ message: 'Memo ID is invalid' });
    }

    const existing = await ModelMemoNote.findOne({ _id, userId }).lean();
    if (!existing) {
      return res.status(404).json({ message: 'Memo not found or unauthorized' });
    }

    await deleteAllMemoFilesAndLegacyStorage(userId, existing as Record<string, unknown>, _id);
    await ModelMemoNote.deleteOne({ _id, userId });
    await ModelGlobalSearch.deleteMany({ entityId: _id });

    return res.json({ message: 'Memo deleted successfully' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.post('/memoEmptyBin', middlewareUserAuth, async (req: Request, res: Response) => {
  try {
    const userId = res.locals.auth_userId as string;
    const trashed = await ModelMemoNote.find({ userId, trashed: true }).lean();
    const trashedIds = trashed.map((d) => d._id as Types.ObjectId);
    if (trashedIds.length > 0) {
      await ModelGlobalSearch.deleteMany({ entityId: { $in: trashedIds } });
    }
    for (const doc of trashed) {
      await deleteAllMemoFilesAndLegacyStorage(userId, doc as Record<string, unknown>, doc._id as Types.ObjectId);
    }
    await ModelMemoNote.deleteMany({ userId, trashed: true });
    return res.json({ message: 'Bin emptied successfully' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
});

/** Normalize sortOrder for one pin group (active notes only). Higher = earlier in UI. */
async function revalidateMemoSortOrderGroup(userId: string, pinned: boolean) {
  const docs = await ModelMemoNote.find({
    userId,
    pinned,
    archived: false,
    trashed: false,
  })
    .sort({ sortOrder: -1, updatedAtUtc: -1 })
    .select({ _id: 1, sortOrder: 1 })
    .lean();

  for (let index = 0; index < docs.length; index++) {
    const desired = docs.length - index;
    const doc = docs[index]!;
    if (doc.sortOrder !== desired) {
      await ModelMemoNote.updateOne({ _id: doc._id, userId }, { $set: { sortOrder: desired } });
    }
  }
}

/** Revalidate sort order for both pinned and unpinned active memos. */
async function revalidateMemoSortOrderAll(userId: string) {
  await revalidateMemoSortOrderGroup(userId, true);
  await revalidateMemoSortOrderGroup(userId, false);
}

/**
 * Move a memo within its pin group (up/down/left/right or jumpToPosition),
 * then revalidate sort order for both pinned and not-pinned active memos.
 * up/left = earlier; down/right = later. jumpToPosition is 1-based.
 */
router.post('/memoRevalidateSortOrderById', middlewareUserAuth, async (req: Request, res: Response) => {
  try {
    const userId = res.locals.auth_userId as string;
    const _id = getMongodbObjectOrNull(req.body?._id);
    if (!_id) {
      return res.status(400).json({ message: 'Memo ID is invalid' });
    }

    const direction = req.body?.direction;
    const jumpRaw = req.body?.jumpToPosition;
    const hasJump = typeof jumpRaw === 'number' && Number.isFinite(jumpRaw);
    const validDirection =
      direction === 'left' || direction === 'right' || direction === 'up' || direction === 'down';

    if (!hasJump && !validDirection) {
      return res.status(400).json({ message: 'direction or jumpToPosition is required' });
    }

    const note = await ModelMemoNote.findOne({
      _id,
      userId,
      archived: false,
      trashed: false,
    }).lean();
    if (!note) {
      return res.status(404).json({ message: 'Memo not found or unauthorized' });
    }

    const siblings = await ModelMemoNote.find({
      userId,
      pinned: note.pinned === true,
      archived: false,
      trashed: false,
    })
      .sort({ sortOrder: -1, updatedAtUtc: -1 })
      .select({ _id: 1, sortOrder: 1, updatedAtUtc: 1 })
      .lean();

    const idx = siblings.findIndex((s) => String(s._id) === String(_id));
    if (idx < 0) {
      return res.status(404).json({ message: 'Memo not found in sort group' });
    }

    if (hasJump) {
      const target = Math.max(0, Math.min(siblings.length - 1, Math.floor(jumpRaw) - 1));
      if (target !== idx) {
        const next = [...siblings];
        const [moved] = next.splice(idx, 1);
        if (moved) {
          next.splice(target, 0, moved);
          for (let i = 0; i < next.length; i++) {
            const desired = next.length - i;
            const doc = next[i]!;
            if (doc.sortOrder !== desired) {
              await ModelMemoNote.updateOne({ _id: doc._id, userId }, { $set: { sortOrder: desired } });
            }
          }
        }
      }
      await revalidateMemoSortOrderAll(userId);
      return res.json({ message: 'Memo jumped to position successfully' });
    }

    const neighborIdx = direction === 'left' || direction === 'up' ? idx - 1 : idx + 1;
    if (neighborIdx < 0 || neighborIdx >= siblings.length) {
      await revalidateMemoSortOrderAll(userId);
      return res.json({ message: 'Memo already at edge; sort order revalidated' });
    }

    const a = siblings[idx]!;
    const b = siblings[neighborIdx]!;
    let orderA = typeof a.sortOrder === 'number' && Number.isFinite(a.sortOrder) ? a.sortOrder : 0;
    let orderB = typeof b.sortOrder === 'number' && Number.isFinite(b.sortOrder) ? b.sortOrder : 0;
    if (orderA === orderB) {
      const base = Date.now();
      if (direction === 'left' || direction === 'up') {
        orderB = base + 1;
        orderA = base;
      } else {
        orderA = base + 1;
        orderB = base;
      }
    }

    await ModelMemoNote.updateOne({ _id: a._id, userId }, { $set: { sortOrder: orderB } });
    await ModelMemoNote.updateOne({ _id: b._id, userId }, { $set: { sortOrder: orderA } });

    await revalidateMemoSortOrderAll(userId);

    return res.json({ message: `Memo moved ${direction} successfully` });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.post('/memoReminders', middlewareUserAuth, async (req: Request, res: Response) => {
  try {
    const userId = res.locals.auth_userId as string;
    const _id = getMongodbObjectOrNull(req.body?._id);
    if (!_id) {
      return res.status(400).json({ message: 'Memo ID is invalid' });
    }
    const rt = parseReminderTime(req.body?.reminderTime);
    if (!rt.ok) {
      return res.status(400).json({ message: rt.message });
    }
    const updated = await ModelMemoNote.findOneAndUpdate(
      { _id, userId },
      { $set: { reminderTime: rt.value, updatedAtUtc: new Date(), updatedAtIpAddress: req.ip || '', updatedAtUserAgent: req.headers['user-agent'] || '' } },
      { new: true },
    ).lean();
    if (!updated) {
      return res.status(404).json({ message: 'Memo not found or unauthorized' });
    }
    return res.json({ message: 'Reminder updated', doc: updated });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.post('/memoBulkAction', middlewareUserAuth, async (req: Request, res: Response) => {
  try {
    const userId = res.locals.auth_userId as string;
    const idsInput = req.body?.ids;
    const action = req.body?.action as string;
    if (!Array.isArray(idsInput) || idsInput.length === 0) {
      return res.status(400).json({ message: 'ids is required' });
    }
    const oids = idsInput.map((x: unknown) => getMongodbObjectOrNull(typeof x === 'string' ? x : null)).filter(Boolean) as Types.ObjectId[];
    if (oids.length === 0) {
      return res.status(400).json({ message: 'No valid ids' });
    }
    if (oids.length > 100) {
      return res.status(400).json({ message: 'Too many ids' });
    }
    const allowed = new Set(['archive', 'unarchive', 'trash', 'restore', 'pin', 'unpin', 'deleteForever']);
    if (!allowed.has(action)) {
      return res.status(400).json({ message: 'Invalid action' });
    }
    const now = new Date();
    if (action === 'deleteForever') {
      const docs = await ModelMemoNote.find({ _id: { $in: oids }, userId }).lean();
      for (const doc of docs) {
        await deleteAllMemoFilesAndLegacyStorage(userId, doc as Record<string, unknown>, doc._id as Types.ObjectId);
      }
      await ModelMemoNote.deleteMany({ _id: { $in: oids }, userId });
      await ModelGlobalSearch.deleteMany({ entityId: { $in: oids } });
      return res.json({ message: 'Bulk deleted', count: docs.length });
    }
    const patch: Record<string, unknown> = { updatedAtUtc: now, updatedAtIpAddress: req.ip || '', updatedAtUserAgent: req.headers['user-agent'] || '' };
    if (action === 'archive') {
      patch.archived = true; patch.trashed = false;
    } else if (action === 'unarchive') {
      patch.archived = false;
    } else if (action === 'trash') {
      patch.trashed = true; patch.archived = false; patch.pinned = false;
    } else if (action === 'restore') {
      patch.trashed = false; patch.archived = false;
    } else if (action === 'pin') {
      patch.pinned = true;
    } else if (action === 'unpin') {
      patch.pinned = false;
    }
    await ModelMemoNote.updateMany({ _id: { $in: oids }, userId }, { $set: patch });
    for (const oid of oids) {
      await reindexDocument({ reindexDocumentArr: [{ collectionName: 'memoNotes', documentId: String(oid) }] });
    }
    return res.json({ message: 'Bulk updated', count: oids.length });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
});

export default router;
