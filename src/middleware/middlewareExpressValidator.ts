import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';

const middlewareExpressValidator = async (
    req: Request,
    res: Response,
    next: NextFunction,
) => {
    try {
        const result = validationResult(req);
        if (result.isEmpty()) {
            return next();
        }
        return res.status(400).json({
            success: '',
            error: 'Validation failed',
            data: {
                errors: result.array()
            },
        });
    } catch (error) {
        return res.status(400).json({
            success: '',
            error: 'Unexpected error occured',
            data: {},
        });
    }
};

export default middlewareExpressValidator;