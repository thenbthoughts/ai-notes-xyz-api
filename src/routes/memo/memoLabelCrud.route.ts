import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelMemoLabel } from '../../schema/schemaMemo/SchemaMemoLabel.schema';
import { ModelMemoNote } from '../../schema/schemaMemo/SchemaMemoNote.schema';
import { getMongodbObjectOrNull } from '../../utils/common/getMongodbObjectOrNull';

const router = Router();

router.post('/memoLabelList', middlewareUserAuth, async (req: Request, res: Response) => {
  try {
    const username = res.locals.auth_username as string;
    const docs = await ModelMemoLabel.find({ username }).sort({ name: 1 }).lean();
    return res.json({ message: 'Labels retrieved successfully', docs });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.post('/memoLabelAdd', middlewareUserAuth, async (req: Request, res: Response) => {
  try {
    const username = res.locals.auth_username as string;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (name.length < 1 || name.length > 80) {
      return res.status(400).json({ message: 'Label name must be 1–80 characters' });
    }

    const now = new Date();
    try {
      const doc = await ModelMemoLabel.create({
        username,
        name,
        createdAtUtc: now,
        updatedAtUtc: now,
      });
      return res.json({ message: 'Label created successfully', doc });
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'code' in e && (e as { code?: number }).code === 11000) {
        return res.status(409).json({ message: 'A label with that name already exists' });
      }
      throw e;
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.post('/memoLabelEdit', middlewareUserAuth, async (req: Request, res: Response) => {
  try {
    const username = res.locals.auth_username as string;
    const _id = getMongodbObjectOrNull(req.body?._id);
    if (!_id) {
      return res.status(400).json({ message: 'Label ID is invalid' });
    }
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (name.length < 1 || name.length > 80) {
      return res.status(400).json({ message: 'Label name must be 1–80 characters' });
    }

    try {
      const doc = await ModelMemoLabel.findOneAndUpdate(
        { _id, username },
        { $set: { name, updatedAtUtc: new Date() } },
        { new: true },
      ).lean();

      if (!doc) {
        return res.status(404).json({ message: 'Label not found' });
      }
      return res.json({ message: 'Label updated successfully', doc });
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'code' in e && (e as { code?: number }).code === 11000) {
        return res.status(409).json({ message: 'A label with that name already exists' });
      }
      throw e;
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.post('/memoLabelDelete', middlewareUserAuth, async (req: Request, res: Response) => {
  try {
    const username = res.locals.auth_username as string;
    const _id = getMongodbObjectOrNull(req.body?._id);
    if (!_id) {
      return res.status(400).json({ message: 'Label ID is invalid' });
    }

    const owned = await ModelMemoLabel.findOne({ _id, username });
    if (!owned) {
      return res.status(404).json({ message: 'Label not found' });
    }

    await ModelMemoNote.updateMany({ username, labelIds: _id }, { $pull: { labelIds: _id } });
    await ModelMemoLabel.deleteOne({ _id, username });

    return res.json({ message: 'Label deleted successfully' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
});

export default router;
