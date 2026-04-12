import { Router, Request, Response } from 'express';
import type { Types } from 'mongoose';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelMemoFile } from '../../schema/schemaMemo/SchemaMemoFile.schema';
import { ModelMemoNote } from '../../schema/schemaMemo/SchemaMemoNote.schema';
import { deleteFileByPath } from '../upload/uploadFileS3ForFeatures';
import { getMongodbObjectOrNull } from '../../utils/common/getMongodbObjectOrNull';
import {
  MAX_IMAGES_PER_NOTE,
  parseFeatureUploadPathForDelete,
  parseMemoImageField,
  deleteMemoStoredImagePathsByFullPaths,
  deleteAllMemoFilesAndLegacyStorage,
} from './memoImageShared';

const router = Router();

async function assertMemoOwned(username: string, memoNoteId: Types.ObjectId): Promise<boolean> {
  const n = await ModelMemoNote.countDocuments({ _id: memoNoteId, username });
  return n === 1;
}

/** List uploaded file paths for a memo (ordered). */
router.post('/memoFileList', middlewareUserAuth, async (req: Request, res: Response) => {
  try {
    const username = res.locals.auth_username as string;
    const memoNoteId = getMongodbObjectOrNull(req.body?.memoNoteId);
    if (!memoNoteId) {
      return res.status(400).json({ message: 'memoNoteId is invalid' });
    }
    if (!(await assertMemoOwned(username, memoNoteId))) {
      return res.status(404).json({ message: 'Memo not found or unauthorized' });
    }
    const rows = await ModelMemoFile.find({ username, memoNoteId })
      .sort({ sortOrder: 1, createdAtUtc: 1 })
      .lean();
    const paths = rows.map((r) => r.filePath);
    return res.json({ message: 'OK', paths });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
});

/**
 * Register an uploaded storage path for a memo (file bytes were stored via `POST /api/uploads/crud/uploadFile`).
 */
router.post('/memoFileAdd', middlewareUserAuth, async (req: Request, res: Response) => {
  try {
    const username = res.locals.auth_username as string;
    const memoNoteId = getMongodbObjectOrNull(req.body?.memoNoteId);
    if (!memoNoteId) {
      return res.status(400).json({ message: 'memoNoteId is invalid' });
    }
    if (!(await assertMemoOwned(username, memoNoteId))) {
      return res.status(404).json({ message: 'Memo not found or unauthorized' });
    }

    const parsed = parseMemoImageField(req.body?.filePath);
    if (!parsed.ok) {
      return res.status(400).json({ message: parsed.message });
    }
    const filePath = parsed.value;
    if (!filePath.startsWith('ai-notes-xyz/')) {
      return res.status(400).json({ message: 'Only uploaded storage paths can be registered' });
    }
    if (!filePath.startsWith(`ai-notes-xyz/${username}/`)) {
      return res.status(400).json({ message: 'Invalid file path for user' });
    }

    const existing = await ModelMemoFile.countDocuments({ username, memoNoteId });
    if (existing >= MAX_IMAGES_PER_NOTE) {
      return res.status(400).json({ message: `At most ${MAX_IMAGES_PER_NOTE} images per memo` });
    }

    const dup = await ModelMemoFile.countDocuments({ username, memoNoteId, filePath });
    if (dup > 0) {
      return res.status(400).json({ message: 'Image already attached to this memo' });
    }

    const last = await ModelMemoFile.findOne({ username, memoNoteId }).sort({ sortOrder: -1 }).lean();
    const sortOrder = (last?.sortOrder ?? -1) + 1;

    const created = await ModelMemoFile.create({
      username,
      memoNoteId,
      filePath,
      sortOrder,
      createdAtUtc: new Date(),
    });

    return res.status(201).json({
      message: 'Memo file registered',
      doc: {
        _id: created._id,
        memoNoteId: String(memoNoteId),
        filePath,
        sortOrder,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.post('/memoFileDelete', middlewareUserAuth, async (req: Request, res: Response) => {
  try {
    const username = res.locals.auth_username as string;
    const memoNoteId = getMongodbObjectOrNull(req.body?.memoNoteId);
    if (!memoNoteId) {
      return res.status(400).json({ message: 'memoNoteId is invalid' });
    }
    const parsed = parseMemoImageField(req.body?.filePath);
    if (!parsed.ok || !parsed.value) {
      return res.status(400).json({ message: parsed.ok ? 'filePath is required' : parsed.message });
    }
    const filePath = parsed.value;
    if (!filePath.startsWith('ai-notes-xyz/')) {
      return res.status(400).json({ message: 'Only storage paths can be removed here' });
    }

    const row = await ModelMemoFile.findOneAndDelete({ username, memoNoteId, filePath });
    if (!row) {
      return res.status(404).json({ message: 'Memo file not found' });
    }

    await deleteMemoStoredImagePathsByFullPaths(username, [filePath]);

    return res.json({ message: 'Memo file removed' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
});

/** Remove all memoFiles rows for a memo and delete blobs from storage. */
router.post('/memoFileClear', middlewareUserAuth, async (req: Request, res: Response) => {
  try {
    const username = res.locals.auth_username as string;
    const memoNoteId = getMongodbObjectOrNull(req.body?.memoNoteId);
    if (!memoNoteId) {
      return res.status(400).json({ message: 'memoNoteId is invalid' });
    }
    if (!(await assertMemoOwned(username, memoNoteId))) {
      return res.status(404).json({ message: 'Memo not found or unauthorized' });
    }

    const rows = await ModelMemoFile.find({ username, memoNoteId }).lean();
    const paths = rows.map((r) => r.filePath).filter((p) => p.startsWith('ai-notes-xyz/'));
    await ModelMemoFile.deleteMany({ username, memoNoteId });
    await deleteMemoStoredImagePathsByFullPaths(username, paths);

    return res.json({ message: 'Memo files cleared', removed: rows.length });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
});

/** Same as clearing memo files plus wiping legacy `imageDataUrls` on the memo document (raw collection). */
router.post('/memoClearAllImages', middlewareUserAuth, async (req: Request, res: Response) => {
  try {
    const username = res.locals.auth_username as string;
    const memoNoteId = getMongodbObjectOrNull(req.body?.memoNoteId ?? req.body?._id);
    if (!memoNoteId) {
      return res.status(400).json({ message: 'Memo ID is invalid' });
    }
    if (!(await assertMemoOwned(username, memoNoteId))) {
      return res.status(404).json({ message: 'Memo not found or unauthorized' });
    }
    const existing = await ModelMemoNote.findOne({ _id: memoNoteId, username }).lean();
    if (!existing) {
      return res.status(404).json({ message: 'Memo not found or unauthorized' });
    }
    await deleteAllMemoFilesAndLegacyStorage(username, existing as Record<string, unknown>, memoNoteId);
    await ModelMemoNote.collection.updateOne(
      { _id: memoNoteId, username },
      { $set: { imageDataUrls: [] } } as Record<string, unknown>,
    );
    return res.json({ message: 'All memo images cleared' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
});

export default router;
