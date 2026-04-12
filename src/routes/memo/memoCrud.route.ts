import { Router, Request, Response } from 'express';
import type { Types } from 'mongoose';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelMemoLabel } from '../../schema/schemaMemo/SchemaMemoLabel.schema';
import { ModelMemoNote } from '../../schema/schemaMemo/SchemaMemoNote.schema';
import { deleteFileByPath } from '../upload/uploadFileS3ForFeatures';
import { getMongodbObjectOrNull } from '../../utils/common/getMongodbObjectOrNull';

const router = Router();

const MAX_LABELS_PER_NOTE = 25;
const MAX_IMAGES_PER_NOTE = 25;
const MAX_IMAGE_DATA_URL_LENGTH = 450_000;
const MAX_IMAGE_STORAGE_PATH_LENGTH = 2048;

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

/**
 * Uploaded file paths look like `ai-notes-xyz/{username}/features/{parentEntityId}/{id}.ext`.
 * Usernames may be emails (`@`, `+`, etc.); reject only traversal and obvious junk.
 */
function isValidMemoImageStoragePath(storagePath: string): boolean {
  if (!storagePath.startsWith('ai-notes-xyz/')) return false;
  if (storagePath.length > MAX_IMAGE_STORAGE_PATH_LENGTH) return false;
  if (storagePath.includes('..') || storagePath.includes('\\')) return false;
  if (/[\s\n\r]/.test(storagePath)) return false;
  if (/[\u0000-\u001f\u007f-\u009f]/.test(storagePath)) return false;
  return true;
}

/** Accepts inline data URLs or uploaded storage paths (`ai-notes-xyz/...`). */
function parseMemoImageField(imageInput: unknown): { ok: true; value: string } | { ok: false; message: string } {
  if (imageInput === undefined || imageInput === null) return { ok: true, value: '' };
  if (typeof imageInput !== 'string') return { ok: false, message: 'Each image must be a string' };
  const trimmedImageValue = imageInput.trim();
  if (trimmedImageValue === '') return { ok: true, value: '' };
  if (trimmedImageValue.startsWith('data:image/')) {
    if (trimmedImageValue.length > MAX_IMAGE_DATA_URL_LENGTH) {
      return { ok: false, message: 'Image is too large; try a smaller photo' };
    }
    return { ok: true, value: trimmedImageValue };
  }
  if (trimmedImageValue.startsWith('ai-notes-xyz/')) {
    if (!isValidMemoImageStoragePath(trimmedImageValue)) {
      return { ok: false, message: 'Invalid image path' };
    }
    return { ok: true, value: trimmedImageValue };
  }
  return { ok: false, message: 'image must be a data URL or an uploaded file path' };
}

function normalizeMemoImageUrlsFromDoc(doc: Record<string, unknown>): string[] {
  const imageDataUrlsRaw = doc.imageDataUrls;
  if (!Array.isArray(imageDataUrlsRaw) || imageDataUrlsRaw.length === 0) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const imageItem of imageDataUrlsRaw) {
    if (typeof imageItem !== 'string' || !imageItem.trim()) continue;
    const trimmedImageValue = imageItem.trim();
    if (seen.has(trimmedImageValue)) continue;
    seen.add(trimmedImageValue);
    out.push(trimmedImageValue);
  }
  return out;
}

/** Parses `ai-notes-xyz/{username}/features/{parentEntityId}/{fileName}` for `deleteFileByPath`. */
function parseFeatureUploadPathForDelete(
  username: string,
  fileUploadPath: string,
): { parentEntityId: string; fileName: string } | null {
  const prefix = `ai-notes-xyz/${username}/features/`;
  const trimmedUploadPath = fileUploadPath.trim();
  if (!trimmedUploadPath.startsWith(prefix)) return null;
  const rest = trimmedUploadPath.slice(prefix.length);
  const i = rest.indexOf('/');
  if (i <= 0 || i === rest.length - 1) return null;
  const parentEntityId = rest.slice(0, i);
  const fileName = rest.slice(i + 1);
  if (!fileName || fileName.includes('..')) return null;
  return { parentEntityId, fileName };
}

/** Remove stored uploads (not inline `data:` URLs) referenced by a memo document. */
async function deleteMemoStoredImages(username: string, doc: Record<string, unknown>): Promise<void> {
  const urls = normalizeMemoImageUrlsFromDoc(doc);
  const seen = new Set<string>();
  for (const p of urls) {
    if (typeof p !== 'string' || !p.startsWith('ai-notes-xyz/')) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    const parsed = parseFeatureUploadPathForDelete(username, p);
    if (!parsed) {
      console.error(`deleteMemoStoredImages: skip path (not features layout): ${p}`);
      continue;
    }
    const r = await deleteFileByPath({ username, ...parsed });
    if (!r.success) {
      console.error(`deleteMemoStoredImages: could not delete ${p}: ${r.error}`);
    }
  }
}

/**
 * Deletes stored `ai-notes-xyz/{username}/features/...` files by full path (not `data:` URLs).
 * Used by `POST /memoDeleteStoredImagePaths` after the memo document was updated via `memoEdit`.
 */
async function deleteMemoStoredImagePathsByFullPaths(username: string, pathsToDelete: string[]): Promise<void> {
  const seen = new Set<string>();
  for (const p of pathsToDelete) {
    const pt = typeof p === 'string' ? p.trim() : '';
    if (!pt || seen.has(pt)) continue;
    seen.add(pt);
    if (!pt.startsWith(`ai-notes-xyz/${username}/`)) {
      console.error(`deleteMemoStoredImagePathsByFullPaths: rejected path (not owned by user): ${pt}`);
      continue;
    }
    const parsed = parseFeatureUploadPathForDelete(username, pt);
    if (!parsed) {
      console.error(`deleteMemoStoredImagePathsByFullPaths: skip path (not features layout): ${pt}`);
      continue;
    }
    const r = await deleteFileByPath({ username, ...parsed });
    if (!r.success) {
      console.error(`deleteMemoStoredImagePathsByFullPaths: could not delete ${pt}: ${r.error}`);
    }
  }
}

function parseMemoImageUrls(imageDataUrlsInput: unknown): { ok: true; values: string[] } | { ok: false; message: string } {
  if (imageDataUrlsInput === undefined || imageDataUrlsInput === null) {
    return { ok: true, values: [] };
  }
  if (!Array.isArray(imageDataUrlsInput)) {
    return { ok: false, message: 'imageDataUrls must be an array' };
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const imageItem of imageDataUrlsInput) {
    const parsed = parseMemoImageField(imageItem);
    if (!parsed.ok) {
      return { ok: false, message: parsed.message };
    }
    if (parsed.value === '') continue;
    if (seen.has(parsed.value)) continue;
    seen.add(parsed.value);
    out.push(parsed.value);
    if (out.length > MAX_IMAGES_PER_NOTE) {
      return { ok: false, message: `At most ${MAX_IMAGES_PER_NOTE} images per memo` };
    }
  }
  return { ok: true, values: out };
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
  imageDataUrls?: string[];
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

async function enrichNoteDoc(doc: MemoDocPlain | null): Promise<(MemoDocPlain & { labelNames: string[] }) | null> {
  if (!doc || !doc._id) return null;
  const rawDoc = doc as Record<string, unknown>;
  const slim = rawDoc as MemoDocPlain;
  const username = String(doc.username ?? '');
  const ids = effectiveLabelObjectIds(doc);
  const lbls = ids.length ? await ModelMemoLabel.find({ username, _id: { $in: ids } }).lean() : [];
  const labelNames = ids.map((id) => lbls.find((l) => String(l._id) === String(id))?.name ?? '');
  return {
    ...slim,
    labelIds: ids,
    labelNames,
    imageDataUrls: normalizeMemoImageUrlsFromDoc(rawDoc),
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

    const docsOut = docs.map((d) => {
      const rec = d as Record<string, unknown>;
      return {
        ...rec,
        imageDataUrls: normalizeMemoImageUrlsFromDoc(rec),
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
    const urlsParsed = parseMemoImageUrls(req.body?.imageDataUrls);
    if (!urlsParsed.ok) {
      return res.status(400).json({ message: urlsParsed.message });
    }
    const imageDataUrls = urlsParsed.values;

    if (!title && !body && imageDataUrls.length === 0) {
      return res.status(400).json({ message: 'Title, body, or at least one image is required' });
    }

    const now = new Date();
    const created = await ModelMemoNote.create({
      username,
      title: title || (imageDataUrls.length ? 'Image' : ''),
      body,
      labelIds,
      pinned,
      archived: false,
      trashed: false,
      noteColor: nc.value,
      imageDataUrls,
      createdAtUtc: now,
      createdAtIpAddress: req.ip || '',
      createdAtUserAgent: req.headers['user-agent'] || '',
      updatedAtUtc: now,
      updatedAtIpAddress: req.ip || '',
      updatedAtUserAgent: req.headers['user-agent'] || '',
    });

    const lean = created.toObject<MemoDocPlain>();
    const doc = await enrichNoteDoc(lean);

    return res.json({
      message: 'Memo added successfully',
      doc,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.post('/memoDeleteStoredImagePaths', middlewareUserAuth, async (req: Request, res: Response) => {
  try {
    const username = res.locals.auth_username as string;
    const pathsInput = req.body?.paths;
    if (!Array.isArray(pathsInput)) {
      return res.status(400).json({ message: 'paths must be an array' });
    }
    if (pathsInput.length > MAX_IMAGES_PER_NOTE) {
      return res.status(400).json({ message: `At most ${MAX_IMAGES_PER_NOTE} paths per request` });
    }
    const paths: string[] = [];
    const seenIn = new Set<string>();
    for (const item of pathsInput) {
      if (typeof item !== 'string') continue;
      const trimmedPath = item.trim();
      if (!trimmedPath || seenIn.has(trimmedPath)) continue;
      seenIn.add(trimmedPath);
      const parsedField = parseMemoImageField(trimmedPath);
      if (!parsedField.ok) {
        console.warn('memoDeleteStoredImagePaths: skip invalid path', parsedField.message);
        continue;
      }
      if (parsedField.value === '' || parsedField.value.startsWith('data:')) continue;
      paths.push(parsedField.value);
    }
    await deleteMemoStoredImagePathsByFullPaths(username, paths);
    return res.json({
      message: 'Storage paths processed',
      requested: paths.length,
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

    if (Object.prototype.hasOwnProperty.call(req.body, 'imageDataUrls')) {
      const urls = parseMemoImageUrls(req.body.imageDataUrls);
      if (!urls.ok) {
        return res.status(400).json({ message: urls.message });
      }
      updateObj.imageDataUrls = urls.values;
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

    await deleteMemoStoredImages(username, existing as Record<string, unknown>);
    await ModelMemoNote.deleteOne({ _id, username });

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
    for (const doc of trashed) {
      await deleteMemoStoredImages(username, doc as Record<string, unknown>);
    }
    await ModelMemoNote.deleteMany({ username, trashed: true });
    return res.json({ message: 'Bin emptied successfully' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
});

export default router;
