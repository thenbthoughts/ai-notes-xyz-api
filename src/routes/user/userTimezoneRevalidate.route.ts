import express from 'express';

const router = express.Router();

/**
 * POST /user/timezone-revalidate
 * Body params:
 *   - region: string (IANA timezone, e.g. "Asia/Kolkata") required
 * 
 * Updates all records in the collection by recalculating pagination date strings
 * using an aggregation pipeline and bulkWrite for efficient updates.
 */
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelUser } from '../../schema/schemaUser/SchemaUser.schema';

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

      return res.json({
        success: 'Updated successfully',
        error: '',
        data: {
          timeZoneRegion,
          timeZoneUtcOffset,
        }
      });
    } catch (error) {
      console.error('Error in revalidate:', error);
      return res.status(500).json({ success: '', error: 'Internal server error' });
    }
  }
);

export default router;
