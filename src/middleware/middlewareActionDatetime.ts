import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to set actionDatetime object in res.locals
 * Fields: dateTimeUtc, userAgent, createdAt, createdAtIpAddress, updatedAt, updatedAtIpAddress
 */
export function middlewareActionDatetime(req: Request, res: Response, next: NextFunction) {
  const nowIso = new Date().toISOString();
  try {
    const ip = (
      req.headers['x-forwarded-for']?.toString().split(',').shift() ||
      req.socket?.remoteAddress ||
      req.ip ||
      ''
    );
    const userAgent = req.headers['user-agent'] || '';

    res.locals.actionDatetime = {
      createdAtUtc: nowIso,
      createdAtIpAddress: ip,
      createdAtUserAgent: userAgent,
      updatedAtUtc: nowIso,
      updatedAtIpAddress: ip,
      updatedAtUserAgent: userAgent,
    };
    next();
  } catch (error) {
    console.error('Error in middlewareActionDatetime:', error);
    res.locals.actionDatetime = {
      createdAtUtc: nowIso,
      createdAtIpAddress: '',
      createdAtUserAgent: '',
      updatedAtUtc: nowIso,
      updatedAtIpAddress: '',
      updatedAtUserAgent: '',
    };
    next();
  }
}

export default middlewareActionDatetime;
