import express from 'express';
import { ModelChatOne } from '../../schema/SchemaChatOne.schema';
import { DateTime } from 'luxon';

const router = express.Router();

/**
 * POST /chatOne/revalidate
 * Body params:
 *   - region: string (IANA timezone, e.g. "Asia/Kolkata") required
 * 
 * Updates all records in the collection by recalculating pagination date strings
 * using an aggregation pipeline and bulkWrite for efficient updates.
 */
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelUser } from '../../schema/SchemaUser.schema';
import { IChatOne } from '../../types/typesSchema/SchemaChatOne.types';

router.post(
  '/revalidate',
  middlewareUserAuth,
  async (req, res) => {
    try {
      const {
        timeZoneRegion,
        timeZoneUtcOffset
      } = req.body;

      if (!timeZoneRegion || typeof timeZoneRegion !== 'string') {
        return res.status(400).json({
          success: '',
          error: 'Missing or invalid region parameter'
        });
      }
      if (!timeZoneUtcOffset || typeof timeZoneUtcOffset !== 'number') {
        return res.status(400).json({ success: '', error: 'Missing or invalid region parameter' });
      }

      const username = res.locals.auth_username;
      if (!username) {
        return res.status(401).json({ success: '', error: 'Unauthorized: username not found' });
      }

      // Update user
      await ModelUser.updateOne(
        {
          username: username,
        },
        {
          $set: {
            timeZoneRegion,
            timeZoneUtcOffset,
          }
        }
      )

      // Use aggregation pipeline to project _id and createdAtUtc for this user
      const docs = await ModelChatOne.aggregate([
        { $match: { createdAtUtc: { $ne: null }, username } },
      ]) as IChatOne[];

      if (!docs.length) {
        return res.json({ success: 'No documents with createdAtUtc found for user', error: '', });
      }

      // Prepare bulk update operations using aggregation results
      const bulkOps = docs.map(doc => {
        const createdAtUtc = doc.createdAtUtc;
        if (!createdAtUtc) return null;

        // Convert createdAtUtc to specified region timezone using luxon
        const localDate = DateTime.fromISO(createdAtUtc.toISOString()).plus({
          minutes: timeZoneUtcOffset
        }).toUTC();

        const paginationDateLocalYearMonthStr = localDate.toFormat('yyyy-MM');
        const paginationDateLocalYearMonthDateStr = localDate.toFormat('yyyy-MM-dd');

        return {
          updateOne: {
            filter: { _id: doc._id },
            update: {
              $set: {
                paginationDateLocalYearMonthStr,
                paginationDateLocalYearMonthDateStr,
              },
            },
          },
        };
      }).filter(op => op !== null);

      if (!bulkOps.length) {
        return res.json({ success: 'No valid documents to update', error: '' });
      }

      const bulkWriteResult = await ModelChatOne.bulkWrite(bulkOps);

      return res.json({
        success: 'Updated successfully',
        error: '',
        data: {
          matchedCount: bulkWriteResult.matchedCount,
          modifiedCount: bulkWriteResult.modifiedCount,
        }
      });
    } catch (error) {
      console.error('Error in revalidate:', error);
      return res.status(500).json({ success: '', error: 'Internal server error' });
    }
  }
);

export default router;
