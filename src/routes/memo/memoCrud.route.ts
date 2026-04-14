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

type MemoDocPlain = {
  _id: Types.ObjectId;
  username: string;
  title?: string;
  body?: string;
  labelIds?: Types.ObjectId[];
  pinned?: boolean;
  archived?: boolean;
  trashed?: boolean;
  noteColor?: string;
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

async function assertLabelsOwned(username: string, ids: Types.ObjectId[]) {
  if (ids.length === 0) {
    return true;
  }
  const count = await ModelMemoLabel.countDocuments({ username, _id: { $in: ids } });
  return count === ids.length;
}

async function parseAndValidateLabelIds(
  username: string,
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
  if (!(await assertLabelsOwned(username, ids))) {
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
  const username = String(doc.username ?? '');
  const ids = effectiveLabelObjectIds(doc);
  const lbls = ids.length ? await ModelMemoLabel.find({ username, _id: { $in: ids } }).lean() : [];
  const labelNames = ids.map((id) => lbls.find((l) => String(l._id) === String(id))?.name ?? '');
  const files = await ModelMemoFile.find({ username, memoNoteId: doc._id }).sort({ sortOrder: 1, createdAtUtc: 1 }).lean();
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
          let: { ids: '$effectiveMemoLabelIds', user: '$username' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $in: ['$_id', '$$ids'] }, { $eq: ['$username', '$$user'] }],
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

    const username = res.locals.auth_username as string;
    const limit =
      typeof req.body?.limit === 'number' && req.body.limit >= 1 && req.body.limit <= 2000
        ? req.body.limit
        : 1000;

    const docs = await ModelMemoNote.aggregate([
      { $match: { username } },
      { $sort: { updatedAtUtc: -1 } },
      { $limit: limit },
      ...memoLabelResolutionStages,
    ]);

    const noteIds = docs.map((d) => d._id as Types.ObjectId);
    const fileRows =
      noteIds.length > 0
        ? await ModelMemoFile.find({ username, memoNoteId: { $in: noteIds } })
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
    const username = res.locals.auth_username as string;
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    const pinned = req.body?.pinned === true;

    const parsed = await parseAndValidateLabelIds(username, req.body?.labelIds);
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

    const now = new Date();
    const created = await ModelMemoNote.create({
      username,
      title: title || '',
      body,
      labelIds,
      pinned,
      archived: false,
      trashed: false,
      noteColor: nc.value,
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
    const username = res.locals.auth_username as string;
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
      const parsed = await parseAndValidateLabelIds(username, req.body.labelIds);
      if (!parsed.ok) {
        return res.status(400).json({ message: parsed.message });
      }
      updateObj.labelIds = parsed.ids;
    }
    const updatePayload: { $set: Record<string, unknown> } = { $set: updateObj };
    const result = await ModelMemoNote.updateOne({ _id, username }, updatePayload);

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
    const username = res.locals.auth_username as string;
    const _id = getMongodbObjectOrNull(req.body?._id);
    if (!_id) {
      return res.status(400).json({ message: 'Memo ID is invalid' });
    }

    const existing = await ModelMemoNote.findOne({ _id, username }).lean();
    if (!existing) {
      return res.status(404).json({ message: 'Memo not found or unauthorized' });
    }

    await deleteAllMemoFilesAndLegacyStorage(username, existing as Record<string, unknown>, _id);
    await ModelMemoNote.deleteOne({ _id, username });
    await ModelGlobalSearch.deleteMany({ entityId: _id });

    return res.json({ message: 'Memo deleted successfully' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.post('/memoEmptyBin', middlewareUserAuth, async (req: Request, res: Response) => {
  try {
    const username = res.locals.auth_username as string;
    const trashed = await ModelMemoNote.find({ username, trashed: true }).lean();
    const trashedIds = trashed.map((d) => d._id as Types.ObjectId);
    if (trashedIds.length > 0) {
      await ModelGlobalSearch.deleteMany({ entityId: { $in: trashedIds } });
    }
    for (const doc of trashed) {
      await deleteAllMemoFilesAndLegacyStorage(username, doc as Record<string, unknown>, doc._id as Types.ObjectId);
    }
    await ModelMemoNote.deleteMany({ username, trashed: true });
    return res.json({ message: 'Bin emptied successfully' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
});

export default router;
